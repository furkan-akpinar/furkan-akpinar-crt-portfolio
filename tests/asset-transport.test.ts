import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { brotliCompressSync, brotliDecompressSync, gzipSync, gunzipSync } from 'node:zlib';
import test from 'node:test';
import { createAssetRoots } from '../scripts/release-assets.ts';
import { acceptedEncodings, serveAsset } from '../worker/asset-worker.ts';

const modelURL = 'https://example.test/assets/0123456789abcdefabcd/models/furkan-crt/furkan-crt-computer.glb';
const original = Buffer.from('A lossless model buffer.\0'.repeat(100));
const variants = new Map([
  ['', original], ['.br', brotliCompressSync(original)], ['.gz', gzipSync(original)],
]);

function assetFixture(missing = new Set<string>()) {
  const requests: Request[] = [];
  return {
    requests,
    async fetch(request: Request) {
      requests.push(request);
      const suffix = new URL(request.url).pathname.split('furkan-crt-computer.glb')[1];
      const body = variants.get(suffix);
      if (!body || missing.has(suffix)) return new Response('Not found', { status: 404 });
      const etag = `"model${suffix}"`;
      const headers = new Headers({
        'Content-Type': 'model/gltf-binary', ETag: etag,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Length': String(body.length), 'Accept-Ranges': 'bytes',
      });
      if (request.headers.get('If-None-Match') === etag) {
        headers.delete('Content-Length');
        return new Response(null, { status: 304, headers });
      }
      if (request.headers.get('Range') === 'bytes=0-7') {
        headers.set('Content-Range', `bytes 0-7/${body.length}`);
        headers.set('Content-Length', '8');
        return new Response(body.subarray(0, 8), { status: 206, headers });
      }
      return new Response(request.method === 'HEAD' ? null : body, { headers });
    },
  };
}

test('encoding negotiation respects weights, wildcard exclusions and identity', () => {
  assert.deepEqual(acceptedEncodings(null), ['identity']);
  assert.deepEqual(acceptedEncodings('gzip, deflate, br'), ['br', 'gzip', 'identity']);
  assert.deepEqual(acceptedEncodings('br;q=0.2, gzip;q=0.8, identity;q=0.1'), ['gzip', 'br', 'identity']);
  assert.deepEqual(acceptedEncodings('*;q=1, br;q=0'), ['gzip', 'identity']);
  assert.deepEqual(acceptedEncodings('*;q=0'), []);
  assert.deepEqual(acceptedEncodings('br;q=bogus, gzip;q=4'), ['identity']);
});

for (const [encoding, suffix, decompress] of [
  ['br', '.br', brotliDecompressSync], ['gzip', '.gz', gunzipSync],
] as const) {
  test(`${encoding} serves precompressed exact model with the variant ETag and immutable policy`, async () => {
    const assets = assetFixture();
    const response = await serveAsset(new Request(modelURL, { headers: { 'Accept-Encoding': encoding } }), assets);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Encoding'), encoding);
    assert.equal(response.headers.get('Content-Length'), String(variants.get(suffix)!.length));
    assert.equal(response.headers.get('Content-Type'), 'model/gltf-binary');
    assert.equal(response.headers.get('Vary'), 'Accept-Encoding');
    assert.equal(response.headers.get('ETag'), `"model${suffix}"`);
    assert.match(response.headers.get('Cache-Control')!, /immutable/);
    assert.equal(response.headers.get('Accept-Ranges'), null);
    assert.ok(decompress(Buffer.from(await response.arrayBuffer())).equals(original));
    assert.equal(assets.requests[0].url, modelURL + suffix);
    assert.equal(assets.requests[0].headers.get('Accept-Encoding'), 'identity');
  });
}

test('identity clients receive the untouched model bytes', async () => {
  const response = await serveAsset(new Request(modelURL), assetFixture());
  assert.equal(response.headers.get('Content-Encoding'), null);
  assert.ok(Buffer.from(await response.arrayBuffer()).equals(original));
});

test('HEAD advertises the chosen compressed length without a response body', async () => {
  const response = await serveAsset(new Request(modelURL, { method: 'HEAD', headers: { 'Accept-Encoding': 'br' } }), assetFixture());
  assert.equal(response.headers.get('Content-Encoding'), 'br');
  assert.equal(response.headers.get('Content-Length'), String(variants.get('.br')!.length));
  assert.equal((await response.arrayBuffer()).byteLength, 0);
});

test('conditional requests revalidate the selected representation without returning bytes', async () => {
  const response = await serveAsset(new Request(modelURL, {
    headers: { 'Accept-Encoding': 'br', 'If-None-Match': '"model.br"' },
  }), assetFixture());
  assert.equal(response.status, 304);
  assert.equal(response.headers.get('Content-Encoding'), 'br');
  assert.equal(response.headers.get('ETag'), '"model.br"');
  assert.equal((await response.arrayBuffer()).byteLength, 0);
});

test('byte ranges keep the original representation and Content-Range', async () => {
  const assets = assetFixture();
  const response = await serveAsset(new Request(modelURL, {
    headers: { Range: 'bytes=0-7', 'Accept-Encoding': 'br, gzip' },
  }), assets);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Encoding'), null);
  assert.equal(response.headers.get('Content-Range'), `bytes 0-7/${original.length}`);
  assert.ok(Buffer.from(await response.arrayBuffer()).equals(original.subarray(0, 8)));
  assert.equal(assets.requests[0].url, modelURL);
});

test('unsupported identity range falls back to the complete acceptable compressed representation', async () => {
  const response = await serveAsset(new Request(modelURL, {
    headers: { Range: 'bytes=0-7', 'Accept-Encoding': 'br, identity;q=0' },
  }), assetFixture());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Encoding'), 'br');
  assert.equal(response.headers.get('Content-Range'), null);
});

test('a missing sidecar falls back only to an acceptable representation', async () => {
  const response = await serveAsset(new Request(modelURL, {
    headers: { 'Accept-Encoding': 'br, gzip' },
  }), assetFixture(new Set(['.br'])));
  assert.equal(response.headers.get('Content-Encoding'), 'gzip');
  const rejected = await serveAsset(new Request(modelURL, {
    headers: { 'Accept-Encoding': 'br, identity;q=0' },
  }), assetFixture(new Set(['.br'])));
  assert.equal(rejected.status, 406);
  assert.equal(rejected.headers.get('Cache-Control'), 'no-store');
});

test('a missing version never becomes an immutable negative cache entry', async () => {
  const response = await serveAsset(new Request(modelURL, {
    headers: { 'Accept-Encoding': 'br, gzip' },
  }), assetFixture(new Set(['', '.br', '.gz'])));
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Content-Encoding'), null);
});

test('the original Cloudflare client capabilities win over a normalized request header', async () => {
  const request = Object.assign(new Request(modelURL, { headers: { 'Accept-Encoding': 'br, gzip' } }), {
    cf: { clientAcceptEncoding: 'gzip' },
  });
  const response = await serveAsset(request, assetFixture());
  assert.equal(response.headers.get('Content-Encoding'), 'gzip');
});

test('unrelated paths and methods keep their existing static asset behavior', async () => {
  for (const request of [new Request('https://example.test/video.mp4'), new Request(modelURL, { method: 'POST' })]) {
    const expected = new Response('Delegated', { status: 418 });
    const response = await serveAsset(request, { async fetch(actual) { assert.equal(actual, request); return expected; } });
    assert.equal(response, expected);
  }
});

test('content roots are deterministic, update on dependency bytes and isolate other groups', t => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'portfolio-asset-roots-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  mkdirSync(path.join(temporary, 'models/furkan-crt'), { recursive: true });
  mkdirSync(path.join(temporary, 'images'));
  writeFileSync(path.join(temporary, 'models/furkan-crt/furkan-crt-computer.glb'), original);
  writeFileSync(path.join(temporary, 'images/poster.webp'), 'poster');
  const groups = { models: ['models'], images: ['images'] };
  const before = createAssetRoots(temporary, groups);
  assert.deepEqual(createAssetRoots(temporary, groups), before);
  assert.match(before.models, /^\/assets\/[a-f0-9]{20}$/);
  writeFileSync(path.join(temporary, 'models/furkan-crt/furkan-crt-computer.glb'), 'updated model');
  const after = createAssetRoots(temporary, groups);
  assert.notEqual(after.models, before.models);
  assert.equal(after.images, before.images);
});
