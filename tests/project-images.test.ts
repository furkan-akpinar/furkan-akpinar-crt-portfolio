import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test, { type TestContext } from 'node:test';
import { portfolio } from '../src/content/portfolio.ts';

// Resolve the application's bundler aliases for Node without changing the
// loader under test or replacing its real Three.js textures and project data.
const moduleURL = new URL('../src/components/scene/project-images.ts', import.meta.url);
const source = readFileSync(moduleURL, 'utf8')
  .replace("'three/webgpu'", JSON.stringify(import.meta.resolve('three/webgpu')))
  .replace("'@/content/portfolio'", JSON.stringify(new URL('../src/content/portfolio.ts', import.meta.url).href))
  .replace("'./project-ring'", JSON.stringify(new URL('../src/components/scene/project-ring.ts', import.meta.url).href));
const javascript = stripTypeScriptTypes(source, { mode: 'strip', sourceUrl: moduleURL.href });
const { createProjectImages } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`) as
  Pick<typeof import('../src/components/scene/project-images.ts'), 'createProjectImages'>;

async function flushMicrotasks() {
  for (let turn = 0; turn < 8; turn++) await Promise.resolve();
}

function installBrowser(t: TestContext) {
  const images: FakeImage[] = [];
  const canvases: { width: number; height: number }[] = [];
  let draws = 0;
  class FakeImage {
    naturalWidth = 1920;
    naturalHeight = 1080;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    src = '';
    constructor() { images.push(this); }
    removeAttribute(name: string) { if (name === 'src') this.src = ''; }
    succeed() { this.onload?.(); }
  }
  const document = {
    createElement(tag: string) {
      assert.equal(tag, 'canvas');
      const canvas = {
        width: 0, height: 0,
        getContext() {
          return {
            fillStyle: '', fillRect() {},
            drawImage() { draws++; },
            getImageData() { return { data: new Uint8ClampedArray(16 * 16 * 4) }; },
          };
        },
      };
      canvases.push(canvas);
      return canvas;
    },
  };
  for (const [key, value] of [['document', document], ['Image', FakeImage]] as const) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  t.mock.timers.enable({ apis: ['setTimeout'] });
  return { images, canvases, get draws() { return draws; }, active: () => images.filter(image => image.src !== '') };
}

test('queued screenshot batches may exceed thirty seconds while each active load stays within its deadline', async t => {
  const browser = installBrowser(t);
  const gallery = createProjectImages(128);
  t.after(() => gallery.dispose());
  let result = 'pending';
  const completion = gallery.ready.then(() => { result = 'ready'; }, error => { result = 'failed'; throw error; });
  assert.equal(browser.active().length, 2);
  let elapsed = 0;
  while (gallery.diagnostics.readyCount < portfolio.projects.length) {
    const batch = browser.active();
    assert.ok(batch.length > 0 && batch.length <= 2, 'only two images may decode concurrently');
    t.mock.timers.tick(16_000);
    elapsed += 16_000;
    await flushMicrotasks();
    assert.equal(result, 'pending');
    batch.forEach(image => image.succeed());
    await flushMicrotasks();
  }
  await completion;
  assert.ok(elapsed > 30_000);
  assert.equal(result, 'ready');
  assert.equal(gallery.diagnostics.readyCount, portfolio.projects.length);
  assert.equal(gallery.diagnostics.error, null);
  assert.equal(browser.active().length, 0);
  assert.ok(browser.images.every(image => image.onload === null && image.onerror === null));
  const draws = browser.draws;
  t.mock.timers.tick(60_000);
  await flushMicrotasks();
  assert.equal(browser.draws, draws, 'successful requests leave no delayed work');
  assert.equal(gallery.diagnostics.error, null);
});

test('an actually stalled image rejects after thirty active seconds and cancels its partner and queue', async t => {
  const browser = installBrowser(t);
  const gallery = createProjectImages(128);
  t.after(() => gallery.dispose());
  const completion = gallery.ready.then(() => 'ready', error => error as Error);
  const lateLoad = browser.images[0].onload;
  t.mock.timers.tick(29_999);
  await flushMicrotasks();
  assert.equal(gallery.diagnostics.error, null);
  t.mock.timers.tick(1);
  const error = await completion;
  assert.ok(error instanceof Error);
  assert.match(error.message, /zaman aşımına/);
  assert.ok(error.message.includes(portfolio.projects[0].image));
  assert.equal(browser.images.length, 2, 'failed work never starts queued downloads');
  assert.equal(browser.active().length, 0);
  lateLoad?.();
  t.mock.timers.tick(60_000);
  await flushMicrotasks();
  assert.equal(gallery.diagnostics.readyCount, 0);
  assert.equal(browser.draws, 0);
  assert.throws(() => gallery.update([0]), /zaman aşımına/);
});

test('an image error rejects immediately and clears the remaining active deadline', async t => {
  const browser = installBrowser(t);
  const gallery = createProjectImages(128);
  t.after(() => gallery.dispose());
  const completion = gallery.ready.then(() => 'ready', error => error as Error);
  browser.images[0].onerror?.();
  const error = await completion;
  assert.ok(error instanceof Error);
  assert.match(error.message, /yüklenemedi/);
  t.mock.timers.tick(60_000);
  await flushMicrotasks();
  assert.equal(gallery.diagnostics.error, error.message);
  assert.equal(browser.active().length, 0);
  assert.equal(browser.images.length, 2);
});

test('disposal cancels active and queued images, releases textures once and ignores late callbacks', async t => {
  const browser = installBrowser(t);
  const gallery = createProjectImages(128);
  t.after(() => gallery.dispose());
  let disposals = 0;
  gallery.textures.forEach(texture => texture.addEventListener('dispose', () => disposals++));
  browser.images[0].succeed();
  await flushMicrotasks();
  assert.equal(browser.images.length, 3);
  const callbacks = browser.active().map(image => image.onload);
  const readyCount = gallery.diagnostics.readyCount;
  const versions = gallery.textures.map(texture => texture.version);
  const draws = browser.draws;
  gallery.dispose();
  gallery.dispose();
  await gallery.ready;
  callbacks.forEach(callback => callback?.());
  t.mock.timers.tick(60_000);
  await flushMicrotasks();
  assert.equal(disposals, portfolio.projects.length);
  assert.equal(browser.images.length, 3);
  assert.equal(browser.active().length, 0);
  assert.equal(gallery.diagnostics.readyCount, readyCount);
  assert.equal(gallery.diagnostics.error, null);
  assert.deepEqual(gallery.textures.map(texture => texture.version), versions);
  assert.equal(browser.draws, draws);
  assert.ok(browser.canvases.every(canvas => canvas.width === 1 && canvas.height === 1));
});
