import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Runs in a clean clone with Node alone: no original archive or image encoder.
assert.equal(process.argv.length, 2, 'Usage: node scripts/verify-computer.mjs');
const directory = fileURLToPath(new URL('../public/models/furkan-crt/', import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(directory, 'model-manifest.json'), 'utf8'));
assert.equal(manifest.version, 1);
assert.equal(manifest.file, 'furkan-crt-computer.glb');
assert.equal(manifest.selfContained, true);
assert.deepEqual(readdirSync(directory).sort(), ['ATTRIBUTION.txt', manifest.file, 'model-manifest.json'].sort(),
  'The published model folder must not contain old models or authoring sources.');
const bytes = readFileSync(path.join(directory, manifest.file));
assert.equal(bytes.length, manifest.bytes, 'Model length changed.');
assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256, 'Model SHA-256 changed.');
assert.ok(bytes.length < 512 * 1024, 'The shared model must stay below 512 KiB.');
assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'Expected a binary glTF model.');
assert.equal(bytes.readUInt32LE(4), 2, 'Expected glTF version 2.');
assert.equal(bytes.readUInt32LE(8), bytes.length, 'Invalid GLB length.');

const chunks = new Map();
for (let offset = 12; offset < bytes.length;) {
  assert.ok(offset + 8 <= bytes.length, 'Truncated GLB chunk header.');
  const length = bytes.readUInt32LE(offset);
  const type = bytes.readUInt32LE(offset + 4);
  assert.equal(length % 4, 0, 'GLB chunks must be four-byte aligned.');
  assert.ok(offset + 8 + length <= bytes.length, 'Truncated GLB chunk.');
  assert.ok(!chunks.has(type), 'Duplicate GLB chunk.');
  chunks.set(type, bytes.subarray(offset + 8, offset + 8 + length));
  offset += 8 + length;
}
assert.deepEqual([...chunks.keys()], [0x4e4f534a, 0x004e4942], 'Expected one JSON and one BIN chunk.');
const model = JSON.parse(chunks.get(0x4e4f534a).toString('utf8'));
const binary = chunks.get(0x004e4942);
assert.equal(model.asset.version, '2.0');
assert.equal(model.buffers.length, 1);
assert.equal(model.buffers[0].uri, undefined, 'The model must not fetch an external geometry file.');
assert.ok(binary.length - model.buffers[0].byteLength >= 0 && binary.length - model.buffers[0].byteLength <= 3);
for (const view of model.bufferViews) {
  assert.equal(view.buffer, 0);
  assert.ok(Number.isInteger(view.byteOffset ?? 0) && (view.byteOffset ?? 0) >= 0);
  assert.ok(Number.isInteger(view.byteLength) && view.byteLength > 0);
  assert.ok((view.byteOffset ?? 0) + view.byteLength <= model.buffers[0].byteLength, 'Buffer view exceeds embedded data.');
}

const images = model.images.map(image => {
  assert.equal(image.uri, undefined, 'Model textures must be embedded.');
  assert.equal(image.mimeType, 'image/png');
  const view = model.bufferViews[image.bufferView];
  assert.ok(view, 'Missing embedded image buffer view.');
  const payload = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  assert.equal(payload.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const width = payload.readUInt32BE(16), height = payload.readUInt32BE(20);
  assert.ok(width > 0 && height > 0 && width <= 1024 && height <= 1024, 'Unexpectedly large model texture.');
  return { mimeType: image.mimeType, bytes: payload.length, width, height };
});
assert.deepEqual(images, manifest.images);
assert.equal(images.length, 3);
const screenNodes = model.nodes.filter(node => node.name === manifest.screenNode);
assert.equal(screenNodes.length, 1, 'The runtime needs exactly one separately addressable CRT display.');
assert.equal(screenNodes[0].extras.role, 'video-display');
assert.equal(screenNodes[0].extras.aspectRatio, 4 / 3);
const screen = model.meshes[screenNodes[0].mesh].primitives[0];
assert.ok(Number.isInteger(screen.attributes.TEXCOORD_0), 'The video display needs UV coordinates.');
let triangles = 0, vertices = 0;
for (const mesh of model.meshes) for (const primitive of mesh.primitives) {
  assert.equal(primitive.mode ?? 4, 4, 'Expected triangle geometry.');
  const indices = model.accessors[primitive.indices];
  const position = model.accessors[primitive.attributes.POSITION];
  assert.equal(indices.count % 3, 0);
  assert.equal(position.type, 'VEC3');
  triangles += indices.count / 3;
  vertices += position.count;
}
assert.equal(model.meshes.length, manifest.meshes);
assert.equal(triangles, manifest.triangles);
assert.equal(vertices, manifest.vertices);
assert.ok(triangles < 15_000 && model.meshes.length <= 8, 'The shared model exceeds its geometry budget.');
console.log(JSON.stringify({ status: 'verified', modelUrl: `/models/furkan-crt/${manifest.file}`,
  bytes: bytes.length, sha256: manifest.sha256, meshes: model.meshes.length, triangles, vertices,
  embeddedImages: images, externalDependencies: 0 }, null, 2));
