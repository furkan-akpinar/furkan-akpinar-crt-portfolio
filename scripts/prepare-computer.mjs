import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// No decoder, image encoder or geometry optimizer is used. All binary payloads
// are exact slices of the registered Sketchfab GLB, which remains untouched.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultSource = path.join(root, 'public/models/commodore64/commodore-64-4k.glb');
const output = path.join(root, 'public/models/commodore64/web');
const modelName = 'commodore-64-4k.gltf';
const manifestName = 'conversion-manifest.json';
const assetLimit = 25 * 1024 * 1024;
const sourceBytes = 99_660_648;
const sourceSha256 = '4fcbfd31272c1e8da6e3148fb79863638781396c7f0c93a21089e427689bd27f';
const geometryBytes = 9_159_116;
const geometryViewCount = 4;
const imageCount = 23;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const semanticHash = value => sha256(Buffer.from(JSON.stringify(canonical(value))));

const args = process.argv.slice(2);
let source = defaultSource;
let verifyOnly = false;
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--verify') verifyOnly = true;
  else if (args[index] === '--source' && args[index + 1] && !args[index + 1].startsWith('--')) {
    source = path.resolve(args[++index]);
  } else throw new Error('Usage: node scripts/prepare-computer.mjs [--verify] [--source path/to/original.glb]');
}

function imageDimensions(bytes, mimeType) {
  if (mimeType === 'image/png') {
    assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'Invalid PNG signature');
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  }
  assert.equal(mimeType, 'image/jpeg', 'Unexpected source image format');
  assert.equal(bytes.readUInt16BE(0), 0xffd8, 'Invalid JPEG signature');
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  for (let offset = 2; offset + 9 < bytes.length;) {
    assert.equal(bytes[offset], 0xff, 'Malformed JPEG marker');
    const marker = bytes[offset + 1];
    if (startOfFrame.has(marker)) return [bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5)];
    const length = bytes.readUInt16BE(offset + 2);
    assert.ok(length >= 2, 'Invalid JPEG segment length');
    offset += length + 2;
  }
  throw new Error('JPEG dimensions were not found');
}

function readSource() {
  const bytes = readFileSync(source);
  assert.equal(bytes.length, sourceBytes, 'Original GLB size differs from the registered source');
  assert.equal(sha256(bytes), sourceSha256, 'Original GLB SHA-256 differs from the registered source');
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const jsonLength = bytes.readUInt32LE(12);
  assert.equal(jsonLength, 25_632, 'Unexpected source JSON chunk');
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const binHeader = 20 + jsonLength;
  const binLength = bytes.readUInt32LE(binHeader);
  assert.equal(bytes.readUInt32LE(binHeader + 4), 0x004e4942);
  assert.equal(binHeader + 8 + binLength, bytes.length, 'Unexpected trailing GLB chunk');
  const bin = bytes.subarray(binHeader + 8);
  assert.deepEqual(json.buffers, [{ byteLength: bin.length }]);
  assert.equal(json.bufferViews.length, geometryViewCount + imageCount);
  assert.equal(json.images.length, imageCount);
  assert.equal(json.nodes.length, 24);
  assert.equal(json.meshes.length, 13);
  assert.equal(json.materials.length, 10);
  assert.equal(json.skins?.length ?? 0, 0);
  assert.equal(json.animations?.length ?? 0, 0);
  assert.deepEqual(json.extensionsUsed, ['KHR_materials_clearcoat']);
  let offset = 0;
  for (const [index, view] of json.bufferViews.entries()) {
    assert.equal(view.buffer, 0);
    assert.equal(view.byteOffset ?? 0, offset, `Source bufferView ${index} is not contiguous`);
    offset += view.byteLength;
    if (index === geometryViewCount - 1) assert.equal(offset, geometryBytes, 'Unexpected geometry boundary');
  }
  assert.equal(offset, bin.length);
  for (const accessor of json.accessors) {
    assert.ok(Number.isInteger(accessor.bufferView) && accessor.bufferView >= 0 && accessor.bufferView < geometryViewCount);
    assert.equal(accessor.sparse, undefined, 'Sparse accessors require an explicit conversion review');
  }
  for (const [index, image] of json.images.entries()) {
    assert.equal(image.bufferView, index + geometryViewCount);
    assert.equal(image.uri, undefined);
    assert.ok(image.mimeType === 'image/png' || image.mimeType === 'image/jpeg');
  }
  return { bytes, json, bin, jsonLength };
}

function prepare(original) {
  const model = structuredClone(original.json);
  model.buffers = [{ byteLength: geometryBytes, uri: 'geometry.bin' }];
  model.bufferViews = model.bufferViews.slice(0, geometryViewCount);
  const payloads = [{ path: 'geometry.bin', role: 'geometry', bytes: original.bin.subarray(0, geometryBytes),
    sourceRange: { byteOffset: 0, byteLength: geometryBytes } }];
  for (const [index, image] of model.images.entries()) {
    const view = original.json.bufferViews[image.bufferView];
    const file = `images/image-${String(index).padStart(2, '0')}.${image.mimeType === 'image/png' ? 'png' : 'jpg'}`;
    const bytes = original.bin.subarray(view.byteOffset, view.byteOffset + view.byteLength);
    payloads.push({ path: file, role: 'image', bytes, imageIndex: index, mimeType: image.mimeType,
      dimensions: imageDimensions(bytes, image.mimeType),
      sourceRange: { bufferView: image.bufferView, byteOffset: view.byteOffset, byteLength: view.byteLength } });
    delete image.bufferView;
    image.uri = file;
  }
  payloads.unshift({ path: modelName, role: 'gltf', bytes: jsonBytes(model) });
  const manifest = {
    version: 1,
    source: { file: 'commodore-64-4k.glb', bytes: original.bytes.length, sha256: sourceSha256,
      jsonChunkBytes: original.jsonLength, jsonSemanticSha256: semanticHash(original.json),
      binChunkBytes: original.bin.length, binSha256: sha256(original.bin) },
    conversion: { method: 'Byte-identical extraction of the four geometry bufferViews and all 23 embedded JPEG/PNG payloads. Only glTF storage URIs and buffer layout change.',
      geometryViewCount, imageCount, recompressed: false, resized: false, geometryModified: false, perFileLimitBytes: assetLimit },
    originalLayout: { buffers: original.json.buffers, bufferViews: original.json.bufferViews },
    files: payloads.map(({ bytes, ...metadata }) => ({ ...metadata, bytes: bytes.length, sha256: sha256(bytes) })),
  };
  // Check every payload before touching generated files. The source is read-only.
  for (const payload of payloads) assert.ok(payload.bytes.length <= assetLimit, `${payload.path} exceeds 25 MiB`);
  mkdirSync(path.join(output, 'images'), { recursive: true });
  for (const payload of payloads) writeFileSync(path.join(output, payload.path), payload.bytes);
  writeFileSync(path.join(output, manifestName), jsonBytes(manifest));
}

function verify(original) {
  const manifestFile = path.join(output, manifestName);
  assert.ok(existsSync(manifestFile), 'Generated package is missing. Supply the registered original with --source to generate it.');
  const manifestBytes = readFileSync(manifestFile);
  assert.ok(manifestBytes.length <= assetLimit);
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.version, 1);
  assert.equal(manifest.source.bytes, sourceBytes);
  assert.equal(manifest.source.sha256, sourceSha256);
  assert.equal(manifest.conversion.geometryViewCount, geometryViewCount);
  assert.equal(manifest.conversion.imageCount, imageCount);
  assert.equal(manifest.files.length, 2 + imageCount);
  const listed = new Set([manifestName]);
  const payloads = new Map();
  for (const entry of manifest.files) {
    assert.match(entry.path, /^(?:images\/)?[a-z0-9._-]+$/, 'Unsafe generated asset path');
    assert.ok(!listed.has(entry.path), `Duplicate file ${entry.path}`);
    listed.add(entry.path);
    const bytes = readFileSync(path.join(output, entry.path));
    assert.equal(bytes.length, entry.bytes, `${entry.path}: byte length mismatch`);
    assert.ok(bytes.length <= assetLimit, `${entry.path} exceeds 25 MiB`);
    assert.equal(sha256(bytes), entry.sha256, `${entry.path}: SHA-256 mismatch`);
    if (entry.role === 'image') assert.deepEqual(imageDimensions(bytes, entry.mimeType), entry.dimensions);
    if (original && entry.sourceRange) {
      const { byteOffset, byteLength } = entry.sourceRange;
      assert.deepEqual(bytes, original.bin.subarray(byteOffset, byteOffset + byteLength), `${entry.path}: source bytes changed`);
    }
    payloads.set(entry.path, bytes);
  }
  function checkDirectory(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = `${prefix}${entry.name}`;
      assert.ok(!entry.isSymbolicLink(), `Unexpected symlink ${relative}`);
      if (entry.isDirectory()) checkDirectory(path.join(directory, entry.name), `${relative}/`);
      else assert.ok(listed.has(relative), `Unexpected file in generated package: ${relative}`);
    }
  }
  checkDirectory(output);
  const model = JSON.parse(payloads.get(modelName));
  assert.deepEqual(model.buffers, [{ byteLength: geometryBytes, uri: 'geometry.bin' }]);
  assert.deepEqual(model.bufferViews, manifest.originalLayout.bufferViews.slice(0, geometryViewCount));
  assert.equal(model.images.length, imageCount);
  const binHash = createHash('sha256');
  binHash.update(payloads.get('geometry.bin'));
  for (const [index, image] of model.images.entries()) {
    const entry = manifest.files.find(file => file.imageIndex === index);
    assert.ok(entry, `Missing image ${index}`);
    assert.equal(image.uri, entry.path);
    assert.equal(image.mimeType, entry.mimeType);
    assert.equal(image.bufferView, undefined);
    assert.equal(entry.sourceRange.bufferView, geometryViewCount + index);
    binHash.update(payloads.get(image.uri));
    delete image.uri;
    image.bufferView = entry.sourceRange.bufferView;
  }
  assert.equal(binHash.digest('hex'), manifest.source.binSha256, 'Reconstructed source BIN differs');
  model.buffers = manifest.originalLayout.buffers;
  model.bufferViews = manifest.originalLayout.bufferViews;
  assert.equal(semanticHash(model), manifest.source.jsonSemanticSha256, 'Original model structure changed');
  if (original) assert.deepEqual(model, original.json, 'Only storage layout may differ from the original model');
  const largest = manifest.files.reduce((a, b) => a.bytes >= b.bytes ? a : b);
  return { status: 'verified', sourceAvailable: Boolean(original), binaryPayloadsByteIdentical: true,
    reconstructedSourceBinSha256: manifest.source.binSha256, files: listed.size,
    totalBytes: manifest.files.reduce((total, file) => total + file.bytes, manifestBytes.length),
    largestFile: largest.path, largestFileBytes: largest.bytes, perFileLimitBytes: assetLimit,
    modelUrl: '/models/commodore64/web/commodore-64-4k.gltf' };
}

const original = existsSync(source) ? readSource() : undefined;
if (!verifyOnly && original) prepare(original);
console.log(JSON.stringify(verify(original), null, 2));
