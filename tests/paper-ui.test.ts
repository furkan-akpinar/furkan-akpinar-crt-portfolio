import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test, { type TestContext } from 'node:test';
import { portfolio } from '../src/content/portfolio.ts';

const moduleURL = new URL('../src/components/scene/paper-ui.ts', import.meta.url);
const source = readFileSync(moduleURL, 'utf8')
  .replace('"three/webgpu"', JSON.stringify(import.meta.resolve('three/webgpu')))
  .replace('"@/content/portfolio"', JSON.stringify(new URL('../src/content/portfolio.ts', import.meta.url).href));
const javascript = stripTypeScriptTypes(source, { mode: 'strip', sourceUrl: moduleURL.href });
const { createPaperUI } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`) as
  Pick<typeof import('../src/components/scene/paper-ui.ts'), 'createPaperUI'>;

function installBrowser(t: TestContext) {
  const images: FakeImage[] = [];
  let portraitDraws = 0;
  class FakeImage {
    naturalWidth = 1536;
    naturalHeight = 1024;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    src = '';
    constructor() { images.push(this); }
    removeAttribute(name: string) { if (name === 'src') this.src = ''; }
  }
  const context = {
    fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {},
    bezierCurveTo() {}, closePath() {}, fill() {}, setTransform() {},
    measureText(text: string) { return { width: text.length * 10 }; },
    drawImage() { portraitDraws++; },
  };
  const document = {
    createElement(tag: string) {
      assert.equal(tag, 'canvas');
      return { width: 0, height: 0, getContext: () => context };
    },
  };
  for (const [key, value] of [['document', document], ['Image', FakeImage], ['window', { devicePixelRatio: 1 }]] as const) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  t.mock.timers.enable({ apis: ['setTimeout'] });
  return { images, get portraitDraws() { return portraitDraws; } };
}

test('About readiness includes its portrait and repeat load calls share one request', async t => {
  const browser = installBrowser(t);
  const paper = createPaperUI(390, 844, true);
  t.after(() => paper.dispose());
  assert.equal(browser.images.length, 0);
  assert.equal(paper.load(), paper.ready);
  assert.equal(paper.load(), paper.ready);
  assert.equal(browser.images.length, 1);
  assert.equal(browser.images[0].src, portfolio.media.people);
  assert.equal(browser.portraitDraws, 0);
  browser.images[0].onload?.();
  await paper.ready;
  assert.ok(browser.portraitDraws > 0);
  assert.equal(browser.images[0].onload, null);
  assert.equal(browser.images[0].onerror, null);
});

test('a failed About portrait rejects readiness instead of exposing an incomplete page', async t => {
  const browser = installBrowser(t);
  const paper = createPaperUI(1440, 900, true);
  t.after(() => paper.dispose());
  const failed = assert.rejects(paper.ready, /Hakkımda fotoğrafı yüklenemedi/);
  paper.load();
  browser.images[0].onerror?.();
  await failed;
  assert.equal(browser.images[0].src, '');
  assert.equal(browser.portraitDraws, 0);
});

test('a portrait request timeout rejects readiness and detaches late callbacks', async t => {
  const browser = installBrowser(t);
  const paper = createPaperUI(390, 844, true);
  t.after(() => paper.dispose());
  const failed = assert.rejects(paper.ready, /Hakkımda fotoğrafı yüklenemedi/);
  paper.load();
  t.mock.timers.tick(30_000);
  await failed;
  assert.equal(browser.images[0].src, '');
  assert.equal(browser.images[0].onload, null);
  assert.equal(browser.images[0].onerror, null);
});

test('disposing before or during portrait loading settles cancellation without drawing', async t => {
  const browser = installBrowser(t);
  const deferred = createPaperUI(390, 844, true);
  deferred.dispose();
  await deferred.ready;
  deferred.load();
  assert.equal(browser.images.length, 0);
  const loading = createPaperUI(390, 844);
  loading.dispose();
  loading.dispose();
  await loading.ready;
  assert.equal(browser.images[0].src, '');
  assert.equal(browser.images[0].onload, null);
  assert.equal(browser.portraitDraws, 0);
});
