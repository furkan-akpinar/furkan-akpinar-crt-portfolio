import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';

// Node's HTTP client preserves encoded wire bytes (fetch would decompress them).
const base = process.argv[2] ?? 'http://127.0.0.1:3256';
const release = JSON.parse(readFileSync(new URL('../dist/.portfolio-build.json', import.meta.url), 'utf8'));
const geometryPath = `${release.assetRoots.models}/models/commodore64/web/geometry.bin`;
const original = readFileSync(new URL('../public/models/commodore64/web/geometry.bin', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const results = [];

function request(relative, headers = {}, method = 'GET') {
  const url = new URL(relative, base);
  return new Promise((resolve, reject) => {
    const outgoing = (url.protocol === 'https:' ? https : http).request(url, { headers, method }, incoming => {
      const chunks = [];
      incoming.on('data', chunk => chunks.push(chunk));
      incoming.on('error', reject);
      incoming.on('end', () => resolve({ status: incoming.statusCode, headers: incoming.headers, body: Buffer.concat(chunks) }));
    });
    outgoing.setTimeout(30_000, () => outgoing.destroy(new Error(`Timed out: ${url.pathname}`)));
    outgoing.on('error', reject);
    outgoing.end();
  });
}

for (const encoding of ['br', 'gzip', 'identity']) {
  const response = await request(geometryPath, { 'Accept-Encoding': encoding });
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-encoding'], encoding === 'identity' ? undefined : encoding);
  assert.match(response.headers['cache-control'], /max-age=31536000, immutable/);
  assert.match(response.headers.vary, /accept-encoding/i);
  const decoded = encoding === 'br' ? brotliDecompressSync(response.body) : encoding === 'gzip' ? gunzipSync(response.body) : response.body;
  assert.equal(digest(decoded), digest(original), `${encoding}: decoded geometry changed`);
  results.push({ encoding, wireBytes: response.body.length, decodedBytes: decoded.length, status: response.status });

  const head = await request(geometryPath, { 'Accept-Encoding': encoding }, 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.headers['content-encoding'], response.headers['content-encoding']);
  // Workerd may omit Content-Length on HEAD; when present it must describe the
  // selected representation. Reading the whole asset to synthesize it is wasteful.
  if (head.headers['content-length']) assert.equal(Number(head.headers['content-length']), response.body.length);
  assert.equal(head.body.length, 0);

  const conditional = await request(geometryPath, { 'Accept-Encoding': encoding, 'If-None-Match': response.headers.etag });
  assert.equal(conditional.status, 304);
  assert.equal(conditional.body.length, 0);
  assert.equal(conditional.headers.etag, response.headers.etag);
}

const range = await request(geometryPath, { 'Accept-Encoding': 'br, gzip', Range: 'bytes=0-15' });
assert.ok([200, 206].includes(range.status));
assert.equal(range.headers['content-encoding'], undefined);
if (range.status === 206) {
  assert.equal(range.headers['content-range'], `bytes 0-15/${original.length}`);
  assert.ok(range.body.equals(original.subarray(0, 16)));
} else {
  // Local Static Assets may ignore Range (also for untouched video files).
  // A complete 200 response is a valid HTTP fallback, never mislabeled as 206.
  assert.equal(range.headers['content-range'], undefined);
  assert.ok(range.body.equals(original));
}

const missing = await request('/assets/00000000000000000000/models/commodore64/web/geometry.bin', { 'Accept-Encoding': 'br, gzip' });
assert.equal(missing.status, 404);
assert.equal(missing.headers['cache-control'], 'no-store');

const unavailable = await request(geometryPath, { 'Accept-Encoding': '*;q=0' });
let strictNegotiationEndToEndVerified = false;
let unsupportedEncodingObservation;
if (unavailable.status === 415 && ['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) {
  // Wrangler's local HTTP proxy can reject an empty encoding set before it
  // reaches the Worker. Worker-level 406 negotiation is covered by unit tests.
  assert.equal(unavailable.body.toString(), 'Unsupported Media Type');
  assert.equal(unavailable.headers['accept-encoding'], 'br, gzip');
  unsupportedEncodingObservation = 'Wrangler local proxy rejected the request before Worker negotiation.';
} else if (unavailable.status === 200 && unavailable.headers.server?.toLowerCase() === 'cloudflare') {
  // The live edge can normalize this synthetic all-forbidden header and return
  // identity bytes. Record the limitation, not a successful 406 negotiation.
  // Normal br/gzip/identity representation checks above remain unconditional.
  assert.equal(unavailable.headers['content-encoding'], undefined);
  assert.equal(digest(unavailable.body), digest(original), 'Cloudflare q=0 fallback changed geometry bytes');
  unsupportedEncodingObservation = 'Cloudflare returned exact identity bytes for *;q=0; strict rejection is not verified end to end.';
} else {
  assert.equal(unavailable.status, 406);
  assert.equal(unavailable.headers['cache-control'], 'no-store');
  assert.equal(unavailable.body.length, 0);
  strictNegotiationEndToEndVerified = true;
  unsupportedEncodingObservation = 'The all-forbidden encoding set was rejected with 406.';
}

const mobilePath = `${release.assetRoots.models}/models/commodore64/mobile/commodore-64-1k.gltf`;
const mobile = await request(mobilePath);
assert.equal(mobile.status, 200);
assert.match(mobile.headers['cache-control'], /immutable/);
const model = JSON.parse(mobile.body.toString());
assert.equal(new URL(model.buffers[0].uri, new URL(mobilePath, base)).pathname, geometryPath);
const texture = await request(new URL(model.images[0].uri, new URL(mobilePath, base)).pathname, {}, 'HEAD');
assert.equal(texture.status, 200);
assert.match(texture.headers['cache-control'], /immutable/);

const videoPath = `${release.assetRoots.media}/media/hero-pinterest/showreel.mp4`;
const video = await request(videoPath, { Range: 'bytes=0-15' });
assert.ok([200, 206].includes(video.status));
const originalVideo = readFileSync(new URL('../public/media/hero-pinterest/showreel.mp4', import.meta.url));
assert.ok(video.body.equals(video.status === 206 ? originalVideo.subarray(0, 16) : originalVideo));
assert.match(video.headers['content-type'], /video\/mp4/);

console.log(JSON.stringify({ base, geometryPath, results, head: true, revalidation: true, rangeStatus: range.status,
  missingVersion: true, unsupportedEncodingStatus: unavailable.status, strictNegotiationEndToEndVerified,
  unsupportedEncodingObservation, gltfRelativeDependencies: true, videoRangeStatus: video.status }, null, 2));
