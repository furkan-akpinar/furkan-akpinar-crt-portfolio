import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Generation needs the pinned Sharp dependency; verification uses Node builtins
// and the published desktop package, never the locally archived original GLB.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'public/models/commodore64/web');
const outputRoot = path.join(root, 'public/models/commodore64/mobile');
const sourceName = 'commodore-64-4k.gltf';
const modelName = 'commodore-64-1k.gltf';
const manifestName = 'conversion-manifest.json';
const maxDimension = 1024;
const assetLimit = 25 * 1024 * 1024;
const originalSha256 = '4fcbfd31272c1e8da6e3148fb79863638781396c7f0c93a21089e427689bd27f';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const args = process.argv.slice(2);
assert.ok(args.length <= 1 && (args.length === 0 || ['--verify', '--generate'].includes(args[0])),
  'Usage: node scripts/prepare-mobile-computer.mjs [--verify | --generate]');

function pngDimensions(bytes) {
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

function readSource() {
  const registry = JSON.parse(readFileSync(path.join(sourceRoot, manifestName)));
  assert.equal(registry.source.sha256, originalSha256, 'Unexpected original model');
  const payloads = new Map();
  for (const entry of registry.files) {
    assert.match(entry.path, /^(?:images\/)?[a-z0-9._-]+$/);
    const bytes = readFileSync(path.join(sourceRoot, entry.path));
    assert.equal(bytes.length, entry.bytes, `${entry.path}: source size changed`);
    assert.equal(sha256(bytes), entry.sha256, `${entry.path}: source hash changed`);
    payloads.set(entry.path, bytes);
  }
  const model = JSON.parse(payloads.get(sourceName));
  assert.equal(model.images.length, 23);
  assert.equal(model.bufferViews.length, 4);
  assert.deepEqual(model.buffers, [{ byteLength: 9_159_116, uri: 'geometry.bin' }]);
  const roles = new Map();
  function register(map, role) {
    if (!map) return;
    const image = model.textures[map.index].source;
    assert.ok(!roles.has(image) || roles.get(image) === role, `Image ${image} has incompatible roles`);
    roles.set(image, role);
  }
  for (const material of model.materials) {
    register(material.pbrMetallicRoughness?.baseColorTexture, 'base-color');
    register(material.pbrMetallicRoughness?.metallicRoughnessTexture, 'metallic-roughness');
    register(material.normalTexture, 'normal');
  }
  assert.equal(roles.size, model.images.length, 'Every image must have an explicit colour/data role');
  const imageEntries = model.images.map((image, index) => {
    const entry = registry.files.find(file => file.imageIndex === index);
    assert.equal(entry?.path, image.uri);
    return { ...entry, textureRole: roles.get(index) };
  });
  return { model, payloads, imageEntries };
}

function mobileModel(source) {
  const model = structuredClone(source.model);
  model.buffers[0].uri = '../web/geometry.bin';
  model.images.forEach((image, index) => {
    image.uri = `images/image-${String(index).padStart(2, '0')}.png`;
    image.mimeType = 'image/png';
  });
  return model;
}

const attribution = `Commodore 64 || Computer (Full Pack) — mobile texture derivative
Creator: dark_igorek
Creator page: https://sketchfab.com/dark_igorek
Source: https://sketchfab.com/3d-models/commodore-64-computer-full-pack-1f43612fa2d54041bbe2bdff8164c2cd
License: Creative Commons Attribution 4.0 International (CC BY 4.0)
License link: https://creativecommons.org/licenses/by/4.0/

Changes: textures reduced to at most 1024 × 1024 and encoded as PNG.
Base colours are filtered in linear-light sRGB; normal and metallic/roughness
channels are filtered as numeric data without gamma or luminance adjustments.
Geometry, UVs, material settings and node transforms are unchanged. Geometry
is shared with ../web/geometry.bin. The original 4K desktop package is intact.
Runtime monitor/keyboard placement and screen replacement remain as described
in ../ATTRIBUTION.txt. No endorsement by the creator is implied.

Reproduce: node scripts/prepare-mobile-computer.mjs --generate
Verify: node scripts/prepare-mobile-computer.mjs --verify
conversion-manifest.json records source/output hashes, sizes and dimensions.
Public attribution: /model-credits.html
`;

async function generate(source) {
  const { default: sharp } = await import('sharp');
  assert.equal(sharp.versions.sharp, '0.35.5', 'Use the pinned Sharp version for regeneration');
  // Bound generation memory; runtime always downloads these pre-sized images.
  sharp.cache(false);
  sharp.concurrency(1);
  const model = mobileModel(source);
  const payloads = [
    { path: modelName, role: 'gltf', bytes: jsonBytes(model) },
    { path: 'ATTRIBUTION.txt', role: 'attribution', bytes: Buffer.from(attribution) },
  ];
  for (const [index, entry] of source.imageEntries.entries()) {
    let pipeline = sharp(source.payloads.get(entry.path), { ignoreIcc: true });
    if (entry.textureRole === 'base-color') pipeline = pipeline.pipelineColourspace('scrgb');
    const bytes = await pipeline.resize(maxDimension, maxDimension, {
      fit: 'inside', withoutEnlargement: true, kernel: 'lanczos3', fastShrinkOnLoad: false,
    }).toColourspace('srgb').png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer();
    payloads.push({ path: model.images[index].uri, role: 'image', imageIndex: index,
      textureRole: entry.textureRole, dimensions: pngDimensions(bytes), bytes,
      source: { path: `../web/${entry.path}`, bytes: entry.bytes, sha256: entry.sha256, dimensions: entry.dimensions },
    });
  }
  const manifest = {
    version: 1,
    source: { path: `../web/${sourceName}`, bytes: source.payloads.get(sourceName).length,
      sha256: sha256(source.payloads.get(sourceName)), originalGlbSha256: originalSha256 },
    geometry: { path: '../web/geometry.bin', bytes: source.payloads.get('geometry.bin').length,
      sha256: sha256(source.payloads.get('geometry.bin')) },
    conversion: { maxDimension, kernel: 'lanczos3', encoding: 'PNG; no palette quantization',
      baseColorFiltering: 'linear-light sRGB', dataFiltering: 'numeric RGB; no gamma, normalise or sharpening',
      geometryModified: false, materialSettingsModified: false, perFileLimitBytes: assetLimit },
    toolchain: { sharp: sharp.versions.sharp, vips: sharp.versions.vips, png: sharp.versions.png, zlib: sharp.versions['zlib-ng'] },
    files: payloads.map(({ bytes, ...entry }) => ({ ...entry, bytes: bytes.length, sha256: sha256(bytes) })),
  };
  for (const payload of payloads) assert.ok(payload.bytes.length <= assetLimit);
  mkdirSync(path.join(outputRoot, 'images'), { recursive: true });
  for (const payload of payloads) writeFileSync(path.join(outputRoot, payload.path), payload.bytes);
  writeFileSync(path.join(outputRoot, manifestName), jsonBytes(manifest));
}

function verify(source) {
  const manifestBytes = readFileSync(path.join(outputRoot, manifestName));
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.version, 1);
  assert.equal(manifest.source.originalGlbSha256, originalSha256);
  assert.equal(manifest.source.sha256, sha256(source.payloads.get(sourceName)));
  assert.equal(manifest.source.bytes, source.payloads.get(sourceName).length);
  assert.equal(manifest.geometry.path, '../web/geometry.bin');
  assert.equal(manifest.geometry.sha256, sha256(source.payloads.get('geometry.bin')));
  assert.equal(manifest.geometry.bytes, source.payloads.get('geometry.bin').length);
  assert.equal(manifest.conversion.maxDimension, maxDimension);
  assert.equal(manifest.conversion.geometryModified, false);
  assert.equal(manifest.conversion.materialSettingsModified, false);
  assert.equal(manifest.files.length, 25);
  const expectedModel = mobileModel(source);
  const listed = new Set([manifestName]);
  let imageCount = 0;
  for (const entry of manifest.files) {
    assert.match(entry.path, /^(?:images\/)?[a-zA-Z0-9._-]+$/);
    assert.ok(!listed.has(entry.path), `Duplicate file ${entry.path}`);
    listed.add(entry.path);
    const bytes = readFileSync(path.join(outputRoot, entry.path));
    assert.equal(bytes.length, entry.bytes, `${entry.path}: size mismatch`);
    assert.equal(sha256(bytes), entry.sha256, `${entry.path}: hash mismatch`);
    assert.ok(bytes.length <= assetLimit, `${entry.path} exceeds 25 MiB`);
    if (entry.role === 'gltf') {
      assert.equal(entry.path, modelName);
      assert.deepEqual(JSON.parse(bytes), expectedModel, 'Only image storage and shared geometry URI may differ');
    } else if (entry.role === 'attribution') {
      assert.equal(entry.path, 'ATTRIBUTION.txt');
      assert.equal(bytes.toString(), attribution);
    } else {
      assert.equal(entry.role, 'image');
      const original = source.imageEntries[entry.imageIndex];
      assert.ok(original, 'Unknown source image');
      assert.equal(entry.path, expectedModel.images[entry.imageIndex].uri);
      assert.equal(entry.textureRole, original.textureRole);
      assert.deepEqual(entry.source, { path: `../web/${original.path}`, bytes: original.bytes,
        sha256: original.sha256, dimensions: original.dimensions });
      const scale = Math.min(1, maxDimension / Math.max(...original.dimensions));
      assert.deepEqual(entry.dimensions, original.dimensions.map(size => Math.round(size * scale)));
      assert.deepEqual(pngDimensions(bytes), entry.dimensions);
      imageCount++;
    }
  }
  assert.equal(imageCount, 23);
  function checkDirectory(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      assert.ok(!entry.isSymbolicLink(), `Unexpected symlink ${relative}`);
      if (entry.isDirectory()) checkDirectory(path.join(directory, entry.name), `${relative}/`);
      else assert.ok(listed.has(relative), `Unexpected generated file ${relative}`);
    }
  }
  checkDirectory(outputRoot);
  return { status: 'verified', modelUrl: '/models/commodore64/mobile/commodore-64-1k.gltf',
    files: listed.size, images: imageCount, maxDimension, geometrySharedByteIdentical: true,
    materialSettingsUnchanged: true, originalGlbRequired: false,
    totalBytes: manifest.files.reduce((sum, file) => sum + file.bytes, manifestBytes.length) };
}

const source = readSource();
if (args[0] === '--generate' || (args.length === 0 && !existsSync(path.join(outputRoot, manifestName)))) await generate(source);
console.log(JSON.stringify(verify(source), null, 2));
