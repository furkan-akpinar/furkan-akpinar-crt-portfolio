import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { serveAsset } from '../worker/asset-worker.ts';
import { HERO_REEL_ASSET } from '../worker/hero-reel-asset.ts';
import { createAssetRoots, releaseAssetGroups } from '../scripts/release-assets.ts';

const url = 'https://example.test/assets/0123456789abcdefabcd/media/hero-pinterest/showreel.mp4';
const video = Uint8Array.from({ length: 128 }, (_, index) => index);
const modified = 'Sat, 10 Oct 2026 12:00:00 GMT';

function fixture() {
  let offset = 0, canceled = false, pulls = 0;
  const requests: Request[] = [];
  return {
    requests,
    get canceled() { return canceled; },
    get pulls() { return pulls; },
    async fetch(request: Request) {
      requests.push(request);
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls++;
          if (offset === video.length) { controller.close(); return; }
          controller.enqueue(video.slice(offset, offset + 16));
          offset += 16;
        },
        cancel() { canceled = true; },
      });
      return new Response(request.method === 'HEAD' ? null : body, { headers: {
        'Content-Length': String(video.length), 'Content-Type': 'video/mp4',
        'Cache-Control': 'public, max-age=31536000, immutable',
        ETag: '"video-v1"', 'Last-Modified': modified, 'X-Content-Type-Options': 'nosniff',
      } });
    },
  };
}

for (const [range, first, last] of [
  ['bytes=0-15', 0, 15], ['bytes=19-52', 19, 52], ['bytes=100-', 100, 127],
  ['bytes=-17', 111, 127], ['bytes=-999', 0, 127], ['bytes=121-999', 121, 127],
] as const) {
  test(`video ${range} streams the exact bytes when static assets ignores Range`, async () => {
    const assets = fixture();
    const response = await serveAsset(new Request(url, { headers: { Range: range } }), assets);
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('Content-Range'), `bytes ${first}-${last}/128`);
    assert.equal(response.headers.get('Content-Length'), String(last - first + 1));
    assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
    assert.equal(response.headers.get('Content-Type'), 'video/mp4');
    assert.equal(response.headers.get('ETag'), '"video-v1"');
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.match(response.headers.get('Cache-Control')!, /immutable/);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), video.slice(first, last + 1));
    assert.equal(assets.requests.length, 1, 'does not start a second upstream download');
    assert.equal(assets.requests[0].headers.get('Range'), range, 'native Range support remains available');
    if (last < video.length - 1) assert.equal(assets.canceled, true);
    if (last === 15) assert.ok(assets.pulls < 8, 'does not buffer or read the complete video for a short range');
  });
}

for (const range of ['bytes=128-', 'bytes=50-20', 'bytes=-0', 'bytes=999999999999999999999-']) {
  test(`video ${range} returns an uncached empty 416`, async () => {
    const assets = fixture();
    const response = await serveAsset(new Request(url, { headers: { Range: range } }), assets);
    assert.equal(response.status, 416);
    assert.equal(response.headers.get('Content-Range'), 'bytes */128');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal((await response.arrayBuffer()).byteLength, 0);
    assert.equal(assets.canceled, true);
  });
}

test('unsupported ranges and stale If-Range validators retain the complete response', async () => {
  const cases: Record<string, string>[] = [
    { Range: 'bytes=0-1,4-5' }, { Range: 'seconds=0-5' }, { Range: 'bytes=-' },
    { Range: 'bytes=0-15', 'If-Range': '"video-old"' },
    { Range: 'bytes=0-15', 'If-Range': 'W/"video-v1"' },
    { Range: 'bytes=0-15', 'If-Range': 'Sun, 11 Oct 2026 12:00:00 GMT' },
  ];
  for (const headers of cases) {
    const response = await serveAsset(new Request(url, { headers }), fixture());
    assert.equal(response.status, 200);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), video);
  }
});

test('matching strong If-Range ETag and date allow range continuation', async () => {
  for (const validator of ['"video-v1"', modified]) {
    const response = await serveAsset(new Request(url, { headers: { Range: 'bytes=64-', 'If-Range': validator } }), fixture());
    assert.equal(response.status, 206);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), video.slice(64));
  }
});

test('a canceled browser range immediately cancels the upstream stream', async () => {
  const assets = fixture();
  const response = await serveAsset(new Request(url, { headers: { Range: 'bytes=0-' } }), assets);
  const reader = response.body!.getReader();
  await reader.read();
  await reader.cancel('Browser suspended preload');
  assert.equal(assets.canceled, true);
  assert.ok(assets.pulls < 8);
});

test('native partial responses, revalidation and errors pass through unchanged', async () => {
  for (const status of [206, 304, 404, 416]) {
    const expected = new Response(status === 304 ? null : 'native', { status });
    const actual = await serveAsset(new Request(url, { headers: { Range: 'bytes=0-15' } }), { fetch: async () => expected });
    assert.equal(actual, expected);
  }
});

test('regular GET, HEAD and other MP4 files keep the existing asset response', async () => {
  for (const request of [new Request(url), new Request(url, { method: 'HEAD', headers: { Range: 'bytes=0-15' } }),
    new Request('https://example.test/media/other.mp4', { headers: { Range: 'bytes=0-15' } })]) {
    const expected = new Response(null, { status: 200 });
    assert.equal(await serveAsset(request, { fetch: async () => expected }), expected);
  }
});

test('an unexpectedly short upstream body fails instead of reporting a complete range', async () => {
  const response = await serveAsset(new Request(url, { headers: { Range: 'bytes=120-' } }), {
    fetch: async () => new Response(video.slice(0, 100), { headers: { 'Content-Length': '128' } }),
  });
  await assert.rejects(response.arrayBuffer(), /ended before/);
});

test('unknown lengths and encoded bodies are not sliced using decoded byte offsets', async () => {
  const cases: Record<string, string>[] = [{}, { 'Content-Length': '128', 'Content-Encoding': 'gzip' }];
  for (const headers of cases) {
    const expected = new Response(video, { headers });
    assert.equal(await serveAsset(new Request(url, { headers: { Range: 'bytes=0-15' } }), { fetch: async () => expected }), expected);
  }
});

test('the unversioned development reel also supports exact range requests', async () => {
  const response = await serveAsset(new Request('https://example.test/media/hero-pinterest/showreel.mp4', { headers: { Range: 'bytes=0-7' } }), fixture());
  assert.equal(response.status, 206);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), video.slice(0, 8));
});

test('current reel metadata exactly matches the packaged file and content-addressed media root', () => {
  const original = readFileSync(new URL('../public' + HERO_REEL_ASSET.path, import.meta.url));
  assert.equal(original.byteLength, HERO_REEL_ASSET.bytes);
  assert.equal(createHash('sha256').update(original).digest('hex'), HERO_REEL_ASSET.sha256);
  assert.equal(createAssetRoots(fileURLToPath(new URL('../public', import.meta.url)), { media: releaseAssetGroups.media }).media, HERO_REEL_ASSET.root);
});

test('current reel still streams exact ranges when the binding omits Content-Length', async () => {
  const original = readFileSync(new URL('../public' + HERO_REEL_ASSET.path, import.meta.url));
  for (const pathname of [HERO_REEL_ASSET.path, HERO_REEL_ASSET.root + HERO_REEL_ASSET.path]) {
    const response = await serveAsset(new Request('https://example.test' + pathname, { headers: { Range: 'bytes=1048576-1048591' } }), {
      fetch: async () => new Response(original, { headers: { 'Content-Type': 'video/mp4' } }),
    });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('Content-Range'), `bytes 1048576-1048591/${original.length}`);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array(original.subarray(1048576, 1048592)));
  }
});

test('current reel HEAD preserves the verified full size without a response body', async () => {
  const response = await serveAsset(new Request('https://example.test' + HERO_REEL_ASSET.root + HERO_REEL_ASSET.path, { method: 'HEAD' }), {
    fetch: async () => new Response(null, { headers: { ETag: '"current-reel"', 'Content-Type': 'video/mp4' } }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Length'), String(HERO_REEL_ASSET.bytes));
  assert.equal(response.headers.get('ETag'), '"current-reel"');
  assert.equal((await response.arrayBuffer()).byteLength, 0);
});
