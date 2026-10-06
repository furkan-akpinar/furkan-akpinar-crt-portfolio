import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { arrangeCommodoreComputer, createCommodoreComputer, shareEquivalentCommodoreOrmView } from '../src/components/scene/commodore-computer.ts';

// Read authored vertex positions, not hand-written boxes, without decoding
// images in Node. This exercises the same lossless glTF package shipped to browsers.
const definition = JSON.parse(fs.readFileSync(new URL('../public/models/commodore64/web/commodore-64-4k.gltf', import.meta.url), 'utf8'));
const binary = fs.readFileSync(new URL('../public/models/commodore64/web/geometry.bin', import.meta.url));
const binaryStart = 0;

function fixture() {
  const owned: Array<{dispose(): void}> = [];
  function node(index: number): THREE.Object3D {
    const description = definition.nodes[index];
    const result = description.mesh === undefined ? new THREE.Group() : (() => {
      const primitive = definition.meshes[description.mesh].primitives[0];
      const accessor = definition.accessors[primitive.attributes.POSITION];
      const view = definition.bufferViews[accessor.bufferView];
      const start = binaryStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
      const positions = new Float32Array(accessor.count * 3);
      for (let vertex = 0; vertex < accessor.count; vertex++) for (let coordinate = 0; coordinate < 3; coordinate++) {
        positions[vertex * 3 + coordinate] = binary.readFloatLE(start + vertex * (view.byteStride ?? 12) + coordinate * 4);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const material = new THREE.MeshStandardMaterial();
      owned.push(geometry, material);
      return new THREE.Mesh(geometry, material);
    })();
    result.name = description.name;
    if (description.matrix) result.applyMatrix4(new THREE.Matrix4().fromArray(description.matrix));
    if (index === 3) result.userData.heroRole = 'keyboard';
    if (index === 16) result.userData.heroRole = 'monitor';
    if (index === 19) result.userData.heroRole = 'screen';
    for (const child of description.children ?? []) result.add(node(child));
    return result;
  }
  const source = new THREE.Group();
  source.add(node(3), node(16));
  return {source, dispose(){owned.forEach((resource)=>resource.dispose());}};
}

function close(actual: number, expected: number, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);
}

test('only identical ORM source, UV transform and sampler views share a GPU texture', () => {
  const roughness = new THREE.Texture();
  roughness.channel = 1;
  const same = roughness.clone();
  const otherUv = roughness.clone();
  otherUv.channel = 2;
  const otherTransform = roughness.clone();
  otherTransform.offset.x = .1;
  const otherSampler = roughness.clone();
  otherSampler.wrapS = THREE.RepeatWrapping;
  const otherSource = new THREE.Texture();
  otherSource.channel = 1;
  const material = new THREE.MeshStandardMaterial({ roughnessMap: roughness, metalnessMap: same });
  let prematureDisposals = 0;
  same.addEventListener('dispose', () => prematureDisposals++);
  try {
    assert.equal(shareEquivalentCommodoreOrmView(material), true);
    assert.equal(material.metalnessMap, roughness);
    assert.equal(prematureDisposals, 0, 'the loader retains cleanup ownership of the unused clone');
    assert.equal(shareEquivalentCommodoreOrmView(material), false, 'already shared views need no work');
    for (const distinct of [otherUv, otherTransform, otherSampler, otherSource]) {
      material.metalnessMap = distinct;
      assert.equal(shareEquivalentCommodoreOrmView(material), false);
      assert.equal(material.metalnessMap, distinct);
    }
  } finally {
    material.dispose();
    for (const texture of [roughness, same, otherUv, otherTransform, otherSampler, otherSource]) texture.dispose();
  }
});

test('the genuine Commodore parts preserve common scale, sit on the floor and do not intersect', () => {
  const model = fixture();
  const material = new THREE.MeshBasicNodeMaterial();
  try {
    const prepared = arrangeCommodoreComputer(model.source, material);
    const monitor = new THREE.Box3().setFromObject(prepared.monitor);
    const keyboard = new THREE.Box3().setFromObject(prepared.keyboard);
    close(prepared.monitor.scale.x, prepared.keyboard.scale.x);
    close(monitor.max.y - monitor.min.y, 2.8);
    close(monitor.min.y, prepared.groundLayout.floorY);
    close(keyboard.min.y, prepared.groundLayout.floorY);
    close(keyboard.min.z - monitor.max.z, .055);
    close((keyboard.min.x + keyboard.max.x) / 2, 0);
    close((monitor.min.x + monitor.max.x) / 2, 0);
    assert.equal(prepared.groundLayout.contacts.length, 2);
    // Original relative physical sizes survive the same uniform conversion.
    close((keyboard.max.x - keyboard.min.x) / (monitor.max.y - monitor.min.y), 4.811648607254028 / 3.774587333202362);
  } finally { model.dispose(); material.dispose(); }
});

test('the supplied video covers the real curved glass without flattening it or stretching its aspect', () => {
  const model = fixture();
  const material = new THREE.MeshBasicNodeMaterial();
  try {
    const screenBefore = model.source.getObjectByName('Object_19') as THREE.Mesh;
    const before = Float32Array.from(screenBefore.geometry.getAttribute('position').array);
    const prepared = arrangeCommodoreComputer(model.source, material);
    assert.deepEqual(prepared.screenMesh.geometry.getAttribute('position').array, before);
    assert.equal(prepared.screenMesh.material, material);
    const uv = prepared.screenMesh.geometry.getAttribute('uv');
    const position = prepared.screenMesh.geometry.getAttribute('position');
    for (let index = 0; index < uv.count; index++) {
      assert.ok(uv.getX(index) >= 0 && uv.getX(index) <= 1);
      assert.ok(uv.getY(index) >= 0 && uv.getY(index) <= 1);
      close(uv.getX(index), (position.getX(index) + 1.5287574529647827) / 3.0575149059295654, 1e-7);
    }
    close(prepared.screenSize.x / prepared.screenSize.y, 3.0575149059295654 / 2.210557460784912);
    close(prepared.screen.position.z, .52);
    close(prepared.screen.position.y, -1.1725 + (1.8959076404571533 + .3562409281730652) * prepared.scale);
    close(prepared.screen.quaternion.angleTo(new THREE.Quaternion()), 0);
    assert.equal(prepared.screenMesh.castShadow, false);
  } finally { model.dispose(); material.dispose(); }
});

test('a model request disposed before decoding aborts safely and leaves the supplied screen material owned by its caller', async () => {
  const originalFetch = globalThis.fetch;
  let signal: AbortSignal | undefined;
  globalThis.fetch = (_input, options) => {
    signal = options?.signal as AbortSignal;
    return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {once:true}));
  };
  const material = new THREE.MeshBasicNodeMaterial();
  let disposals = 0;
  material.addEventListener('dispose', () => disposals++);
  try {
    const computer = createCommodoreComputer(material);
    computer.dispose();
    computer.dispose();
    await computer.ready;
    assert.equal(signal?.aborted, true);
    assert.equal(computer.group.children.length, 0);
    assert.equal(computer.diagnostics.loaded, false);
    assert.equal(disposals, 0);
  } finally { globalThis.fetch = originalFetch; material.dispose(); }
});
