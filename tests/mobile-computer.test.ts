import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { createCommodoreComputer } from '../src/components/scene/commodore-computer.ts';
import { COMPUTER_MODEL_URLS, selectComputerTextureQuality } from '../src/components/scene/model-quality.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const modelRoot = path.join(root, 'public/models/commodore64');
const desktop = JSON.parse(fs.readFileSync(path.join(modelRoot, 'web/commodore-64-4k.gltf'), 'utf8'));
const mobile = JSON.parse(fs.readFileSync(path.join(modelRoot, 'mobile/commodore-64-1k.gltf'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(modelRoot, 'mobile/conversion-manifest.json'), 'utf8'));

test('small screens, coarse pointers and mobile agents select the bounded model before loading', () => {
  const desktopInputs = { viewportWidth: 1440, coarsePointer: false, mobileUserAgent: false };
  assert.equal(selectComputerTextureQuality(desktopInputs), 'desktop');
  assert.equal(selectComputerTextureQuality({ ...desktopInputs, viewportWidth: 899 }), 'mobile');
  assert.equal(selectComputerTextureQuality({ ...desktopInputs, viewportWidth: 900 }), 'desktop');
  assert.equal(selectComputerTextureQuality({ ...desktopInputs, coarsePointer: true }), 'mobile');
  assert.equal(selectComputerTextureQuality({ ...desktopInputs, mobileUserAgent: true }), 'mobile');
  assert.equal(selectComputerTextureQuality({ ...desktopInputs, viewportWidth: 390 }), 'mobile');
});

test('mobile glTF preserves all geometry, UVs, materials, samplers and node transforms', () => {
  const restored = structuredClone(mobile);
  assert.deepEqual(restored.buffers, [{ byteLength: 9_159_116, uri: '../web/geometry.bin' }]);
  restored.buffers = desktop.buffers;
  for (const [index, image] of restored.images.entries()) {
    assert.equal(image.uri, `images/image-${String(index).padStart(2, '0')}.png`);
    assert.equal(image.mimeType, 'image/png');
    image.uri = desktop.images[index].uri;
    image.mimeType = desktop.images[index].mimeType;
  }
  assert.deepEqual(restored, desktop);
  assert.equal(manifest.geometry.sha256, createHash('sha256')
    .update(fs.readFileSync(path.join(modelRoot, 'web/geometry.bin'))).digest('hex'));
});

test('all mobile images are bounded and active model mipmaps stay below 81 MiB', () => {
  const activeImages = new Set<number>();
  const screenIndex = mobile.nodes.findIndex((node: { name: string }) => node.name === 'Object_19');
  function visit(index: number) {
    const node = mobile.nodes[index];
    if (node.mesh !== undefined && index !== screenIndex) {
      for (const primitive of mobile.meshes[node.mesh].primitives) {
        const material = mobile.materials[primitive.material];
        if (!material) continue;
        const pbr = material.pbrMetallicRoughness;
        for (const map of [pbr?.baseColorTexture, pbr?.metallicRoughnessTexture, material.normalTexture]) {
          if (map) activeImages.add(mobile.textures[map.index].source);
        }
      }
    }
    for (const child of node.children ?? []) visit(child);
  }
  for (const name of ['commodore 64_0', 'video monitor 1702_6']) {
    const index = mobile.nodes.findIndex((node: { name: string }) => node.name === name);
    assert.ok(index >= 0);
    visit(index);
  }
  let gpuBytes = 0;
  const imageFiles = manifest.files.filter((entry: { role: string }) => entry.role === 'image');
  assert.equal(imageFiles.length, 23);
  for (const entry of imageFiles) {
    const bytes = fs.readFileSync(path.join(modelRoot, 'mobile', entry.path));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    assert.equal(bytes.length, entry.bytes);
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    assert.deepEqual([width, height], [1024, 1024]);
    if (activeImages.has(entry.imageIndex)) {
      for (let size = 1024; size >= 1; size /= 2) gpuBytes += size * size * 4;
    }
  }
  assert.equal(activeImages.size, 15);
  assert.ok(gpuBytes < 81 * 1024 * 1024);
  assert.equal(gpuBytes, 83_886_060);
});

test('model instances keep their chosen URL and preserve cancellation for both quality levels', async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (input, options) => {
    requested.push(String(input));
    const signal = options?.signal as AbortSignal;
    return new Promise((_resolve, reject) => signal.addEventListener('abort',
      () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  };
  const material = new THREE.MeshBasicNodeMaterial();
  try {
    for (const quality of ['mobile', 'desktop'] as const) {
      const computer = createCommodoreComputer(material, quality);
      assert.equal(computer.diagnostics.textureQuality, quality);
      assert.equal(computer.diagnostics.source, COMPUTER_MODEL_URLS[quality]);
      computer.dispose();
      await computer.ready;
    }
    assert.deepEqual(requested, [COMPUTER_MODEL_URLS.mobile, COMPUTER_MODEL_URLS.desktop]);
  } finally {
    globalThis.fetch = originalFetch;
    material.dispose();
  }
});

test('published mobile assets verify in a clean clone without Sharp or the archived GLB', () => {
  const temporaryBase = fs.realpathSync(os.tmpdir());
  const temporary = fs.mkdtempSync(path.join(temporaryBase, 'mobile-model-verify-'));
  try {
    fs.mkdirSync(path.join(temporary, 'scripts'), { recursive: true });
    fs.copyFileSync(path.join(root, 'scripts/prepare-mobile-computer.mjs'),
      path.join(temporary, 'scripts/prepare-mobile-computer.mjs'));
    for (const variant of ['web', 'mobile']) {
      fs.cpSync(path.join(modelRoot, variant), path.join(temporary, 'public/models/commodore64', variant), { recursive: true });
    }
    assert.equal(fs.existsSync(path.join(temporary, 'node_modules')), false);
    assert.equal(fs.existsSync(path.join(temporary, 'public/models/commodore64/commodore-64-4k.glb')), false);
    const result = spawnSync(process.execPath, ['scripts/prepare-mobile-computer.mjs', '--verify'], {
      cwd: temporary, encoding: 'utf8', timeout: 30_000,
    });
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.status, 'verified');
    assert.equal(summary.geometrySharedByteIdentical, true);
    assert.equal(summary.originalGlbRequired, false);
  } finally {
    assert.ok(path.resolve(temporary).startsWith(temporaryBase + path.sep));
    assert.ok(path.basename(temporary).startsWith('mobile-model-verify-'));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
