import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { arrangeCrtComputer, COMPUTER_MODEL_URL, createCrtComputer } from '../src/components/scene/crt-computer.ts';

type ModelDefinition = {
  scene?: number;
  scenes: Array<{ nodes: number[] }>;
  nodes: Array<{
    name?: string;
    mesh?: number;
    children?: number[];
    matrix?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
  }>;
  meshes: Array<{ primitives: Array<{ attributes: Record<string, number> }> }>;
  accessors: Array<{
    bufferView: number;
    byteOffset?: number;
    componentType: number;
    normalized?: boolean;
    count: number;
    type: 'VEC2' | 'VEC3';
  }>;
  bufferViews: Array<{ buffer: number; byteOffset?: number; byteStride?: number }>;
};

// Decode the published model's actual attributes, including any byte stride,
// without loading browser-only embedded image resources or a GPU in Node.
function modelFixture() {
  const glb = fs.readFileSync(new URL('../public/models/furkan-crt/furkan-crt-computer.glb', import.meta.url));
  assert.equal(glb.readUInt32LE(0), 0x46546c67, 'fixture must be a GLB');
  assert.equal(glb.readUInt32LE(4), 2);
  assert.equal(glb.readUInt32LE(8), glb.length);
  let definition: ModelDefinition | undefined;
  let binary: Buffer | undefined;
  for (let offset = 12; offset < glb.length;) {
    const length = glb.readUInt32LE(offset);
    const kind = glb.readUInt32LE(offset + 4);
    const bytes = glb.subarray(offset + 8, offset + 8 + length);
    if (kind === 0x4e4f534a) definition = JSON.parse(bytes.toString('utf8')) as ModelDefinition;
    if (kind === 0x004e4942) binary = bytes;
    offset += 8 + length;
  }
  assert.ok(definition && binary, 'the published GLB must contain its JSON and binary chunks');
  const model = definition;
  const buffer = binary;
  const owned: Array<{ dispose(): void }> = [];
  function attribute(index: number) {
    const accessor = model.accessors[index];
    const view = model.bufferViews[accessor.bufferView];
    assert.equal(view.buffer, 0, 'the fixture must be self-contained');
    assert.equal(accessor.componentType, 5126, 'position, normal and UV attributes must be floats');
    assert.ok(!accessor.normalized);
    const components = accessor.type === 'VEC2' ? 2 : 3;
    const values = new Float32Array(accessor.count * components);
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const stride = view.byteStride ?? components * 4;
    for (let vertex = 0; vertex < accessor.count; vertex++) {
      for (let component = 0; component < components; component++) {
        values[vertex * components + component] = buffer.readFloatLE(start + vertex * stride + component * 4);
      }
    }
    return new THREE.BufferAttribute(values, components);
  }
  function node(index: number): THREE.Object3D {
    const description = model.nodes[index];
    let object: THREE.Object3D;
    if (description.mesh === undefined) {
      object = new THREE.Group();
    } else {
      const primitives = model.meshes[description.mesh].primitives;
      assert.equal(primitives.length, 1, 'material batches in this GLB have one primitive each');
      const geometry = new THREE.BufferGeometry();
      for (const [gltfName, threeName] of [['POSITION', 'position'], ['NORMAL', 'normal'], ['TEXCOORD_0', 'uv']] as const) {
        const accessor = primitives[0].attributes[gltfName];
        if (accessor !== undefined) geometry.setAttribute(threeName, attribute(accessor));
      }
      const material = new THREE.MeshStandardMaterial();
      owned.push(geometry, material);
      object = new THREE.Mesh(geometry, material);
    }
    object.name = description.name ?? '';
    if (description.matrix) {
      object.applyMatrix4(new THREE.Matrix4().fromArray(description.matrix));
    } else {
      if (description.translation) object.position.fromArray(description.translation);
      if (description.rotation) object.quaternion.fromArray(description.rotation);
      if (description.scale) object.scale.fromArray(description.scale);
    }
    for (const child of description.children ?? []) object.add(node(child));
    return object;
  }
  const source = new THREE.Group();
  for (const index of model.scenes[model.scene ?? 0].nodes) source.add(node(index));
  source.updateMatrixWorld(true);
  return { source, dispose() { for (const resource of owned) resource.dispose(); } };
}

function close(actual: number, expected: number, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}

test('the integrated CRT keeps uniform proportions, one footprint and the approved hero floor/height', () => {
  const fixture = modelFixture();
  const screenMaterial = new THREE.MeshBasicNodeMaterial();
  try {
    const before = new THREE.Box3().setFromObject(fixture.source);
    const beforeSize = before.getSize(new THREE.Vector3());
    const children = [...fixture.source.children];
    const prepared = arrangeCrtComputer(fixture.source, screenMaterial);
    const after = new THREE.Box3().setFromObject(prepared.source);
    const size = after.getSize(new THREE.Vector3());
    close(size.y, 2.8);
    close(after.min.y, -1.1725);
    close(prepared.groundLayout.floorY, -1.1725);
    close(prepared.scale, 2.8 / beforeSize.y);
    close(prepared.source.scale.x, prepared.source.scale.y);
    close(prepared.source.scale.y, prepared.source.scale.z);
    close(size.x / size.y, beforeSize.x / beforeSize.y);
    close(size.z / size.y, beforeSize.z / beforeSize.y);
    close((after.min.x + after.max.x) / 2, 0);
    assert.equal(prepared.source, fixture.source);
    assert.deepEqual(prepared.source.children, children, 'the integrated console is not split or reparented');
    assert.equal(prepared.groundLayout.contacts.length, 1);
    const contact = prepared.groundLayout.contacts[0];
    close(contact.x, (after.min.x + after.max.x) / 2);
    close(contact.z, (after.min.z + after.max.z) / 2);
    close(contact.width, size.x);
    close(contact.depth, size.z);
  } finally { fixture.dispose(); screenMaterial.dispose(); }
});

test('the real curved glass keeps its authored vertices/UVs and anchors the camera at its tilted UV centre', () => {
  const fixture = modelFixture();
  const screenMaterial = new THREE.MeshBasicNodeMaterial();
  try {
    const mesh = fixture.source.getObjectByName('computer-curved-crt-screen') as THREE.Mesh;
    assert.ok(mesh?.isMesh);
    const positionBefore = Float32Array.from(mesh.geometry.getAttribute('position').array);
    const normalBefore = Float32Array.from(mesh.geometry.getAttribute('normal').array);
    const uvBefore = Float32Array.from(mesh.geometry.getAttribute('uv').array);
    const prepared = arrangeCrtComputer(fixture.source, screenMaterial);
    assert.equal(prepared.screenMesh, mesh);
    assert.equal(mesh.material, screenMaterial);
    assert.deepEqual(mesh.geometry.getAttribute('position').array, positionBefore);
    assert.deepEqual(mesh.geometry.getAttribute('normal').array, normalBefore);
    assert.deepEqual(mesh.geometry.getAttribute('uv').array, uvBefore);

    const uv = mesh.geometry.getAttribute('uv');
    const centerIndex = Array.from({ length: uv.count }, (_, index) => index)
      .find(index => uv.getX(index) === .5 && uv.getY(index) === .5);
    assert.notEqual(centerIndex, undefined, 'the real model must supply a centred display vertex');
    const actualCenter = mesh.localToWorld(new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute('position'), centerIndex!));
    close(prepared.screen.position.distanceTo(actualCenter), 0);
    close(prepared.screen.position.z, .52);
    close(prepared.screen.position.y, -1.1725 + 2.55 * prepared.scale);
    const displayNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(prepared.screen.quaternion);
    close(displayNormal.x, 0);
    close(displayNormal.y, .10442597, 1e-6);
    close(displayNormal.z, .99453265, 1e-6);
    assert.ok(Math.abs(prepared.screen.quaternion.x) > .05, 'the baked tilt must not be mistaken for an identity node transform');
    assert.deepEqual(prepared.screen.scale.toArray(), [1, 1, 1], 'the camera/light anchor must not apply the model scale twice');
    close(prepared.screenSize.x, 3 * prepared.scale);
    close(prepared.screenSize.y, 2.25 * Math.sqrt(1 + .105 ** 2) * prepared.scale, 1e-5);
    assert.deepEqual(prepared.screen.userData.size, { width: prepared.screenSize.x, height: prepared.screenSize.y });
    assert.equal(mesh.castShadow, false);
    assert.equal(mesh.receiveShadow, false);
    fixture.source.traverse(object => {
      if ((object as THREE.Mesh).isMesh && object !== mesh) {
        assert.equal(object.castShadow, true);
        assert.equal(object.receiveShadow, true);
      }
    });
  } finally { fixture.dispose(); screenMaterial.dispose(); }
});

test('disposing a pending model twice aborts its only request and preserves caller-owned screen material', async () => {
  const originalFetch = globalThis.fetch;
  let signal: AbortSignal | undefined;
  const requested: string[] = [];
  globalThis.fetch = (input, options) => {
    requested.push(String(input));
    signal = options?.signal as AbortSignal;
    return new Promise((_resolve, reject) => signal!.addEventListener('abort',
      () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  };
  const material = new THREE.MeshBasicNodeMaterial();
  let materialDisposals = 0;
  material.addEventListener('dispose', () => materialDisposals++);
  try {
    const computer = createCrtComputer(material);
    computer.dispose();
    computer.dispose();
    await computer.ready;
    assert.deepEqual(requested, [COMPUTER_MODEL_URL]);
    assert.equal(signal?.aborted, true);
    assert.equal(computer.diagnostics.loaded, false);
    assert.equal(computer.diagnostics.error, null, 'intentional cancellation is not a load failure');
    assert.equal(computer.group.children.length, 0);
    assert.equal(materialDisposals, 0);
  } finally { globalThis.fetch = originalFetch; material.dispose(); }
});

test('HTTP 503 rejects readiness without marking the model loaded or disposing the caller material', async () => {
  const originalFetch = globalThis.fetch;
  let signal: AbortSignal | undefined;
  globalThis.fetch = async (input, options) => {
    assert.equal(String(input), COMPUTER_MODEL_URL);
    signal = options?.signal as AbortSignal;
    return new Response('Temporarily unavailable', { status: 503 });
  };
  const material = new THREE.MeshBasicNodeMaterial();
  let materialDisposals = 0;
  material.addEventListener('dispose', () => materialDisposals++);
  try {
    const computer = createCrtComputer(material);
    await assert.rejects(computer.ready, /CRT model request failed: HTTP 503/);
    assert.equal(computer.diagnostics.loaded, false);
    assert.match(computer.diagnostics.error!, /HTTP 503/);
    assert.equal(signal?.aborted, true);
    assert.equal(materialDisposals, 0);
    computer.dispose();
    computer.dispose();
    assert.equal(computer.group.children.length, 0);
    assert.equal(materialDisposals, 0);
  } finally { globalThis.fetch = originalFetch; material.dispose(); }
});
