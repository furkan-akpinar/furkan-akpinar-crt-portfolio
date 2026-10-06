import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three/webgpu";
import { createOffice, createPhones, createShredder, createTie } from "../src/components/scene/later-models.ts";

const factories = { office: createOffice, shredder: createShredder, tie: createTie, phones: createPhones };

function meshes(group: THREE.Group) {
  const result: THREE.Mesh[] = [];
  group.traverse(object => { if (object instanceof THREE.Mesh) result.push(object); });
  return result;
}

function finite(values: ArrayLike<number>, message: string) {
  for (let index = 0; index < values.length; index++) {
    assert.ok(Number.isFinite(values[index]), `${message}, component ${index}`);
  }
}

test("a larger office reuses instanced geometry instead of adding a mesh per cubicle", () => {
  const small = createOffice({ columns: 2, rows: 3 });
  const large = createOffice({ columns: 7, rows: 6 });
  try {
    assert.equal(small.cells.length, 6);
    assert.equal(large.cells.length, 42);
    const smallMeshes = meshes(small.group), largeMeshes = meshes(large.group);
    assert.equal(largeMeshes.length, smallMeshes.length, "cubicle count does not increase draw-object count");
    const smallInstances = smallMeshes.filter(item => item instanceof THREE.InstancedMesh);
    const largeInstances = largeMeshes.filter(item => item instanceof THREE.InstancedMesh);
    assert.ok(smallInstances.length > 0, "repeated workstation parts are instanced");
    const count = (items: THREE.InstancedMesh[]) => items.reduce((sum, item) => sum + item.count, 0);
    assert.equal(count(largeInstances), count(smallInstances) * 7, "every workstation part follows the requested cell count");
    const centers = new Set(large.cells.map(cell => cell.center.toArray().join(",")));
    assert.equal(centers.size, large.cells.length, "cells do not collapse to the same transform");
    assert.ok(new THREE.Box3().setFromObject(large.group).containsPoint(large.focus), "the camera focus remains inside the field");
  } finally { small.dispose(); large.dispose(); }
});

test("phone receivers retain independent baselines for reversible hierarchical animation", () => {
  const model = createPhones();
  try {
    assert.equal(model.phones.length, 3);
    assert.equal(model.handsets.length, 3);
    assert.equal(model.baselines.length, 3);
    model.group.position.set(2, -3, 1);
    model.group.rotation.set(0.1, -0.3, 0.08);
    model.group.scale.setScalar(0.8);
    model.group.updateMatrixWorld(true);
    model.handsets.forEach((handset, index) => {
      assert.equal(handset.parent, model.phones[index], "a receiver follows its own phone body");
      const baseline = model.baselines[index];
      assert.notEqual(baseline.position, handset.position);
      assert.notEqual(baseline.rotation, handset.rotation);
      const savedPosition = baseline.position.clone(), savedRotation = baseline.rotation.clone();
      const restWorld = handset.matrixWorld.clone();
      handset.position.y += 0.2;
      handset.rotation.x += 0.45;
      model.group.updateMatrixWorld(true);
      finite(handset.matrixWorld.elements, `animated receiver ${index}`);
      assert.notDeepEqual(handset.matrixWorld.elements, restWorld.elements, "the public pivot changes the rendered pose");
      assert.ok(baseline.position.equals(savedPosition), "animation cannot mutate the saved position");
      assert.ok(baseline.rotation.equals(savedRotation), "animation cannot mutate the saved rotation");
      handset.position.copy(baseline.position);
      handset.rotation.copy(baseline.rotation);
      model.group.updateMatrixWorld(true);
      handset.matrixWorld.elements.forEach((value, component) => {
        assert.ok(Math.abs(value - restWorld.elements[component]) < 1e-10, "reverse scroll restores the exact rest transform");
      });
    });
  } finally { model.dispose(); }
});

test("shredder cleanup preserves caller-owned paper and its roller can animate independently", () => {
  const model = createShredder(8);
  const paperGeometry = new THREE.PlaneGeometry(2, 3);
  const paperMaterial = new THREE.MeshBasicNodeMaterial();
  const paper = new THREE.Mesh(paperGeometry, paperMaterial);
  model.group.add(paper);
  let geometryDisposals = 0, materialDisposals = 0;
  paperGeometry.addEventListener("dispose", () => geometryDisposals++);
  paperMaterial.addEventListener("dispose", () => materialDisposals++);
  try {
    assert.equal(model.roller.parent, model.group);
    const housing = model.group.children.find(child => child !== model.roller && child !== paper)!;
    const rest = housing.matrix.clone();
    model.roller.rotation.x = Math.PI * 5;
    model.group.updateMatrixWorld(true);
    finite(model.roller.matrixWorld.elements, "feed roller animation");
    assert.ok(housing.matrix.equals(rest), "feeding paper does not rotate the beam housing");
    model.dispose();
    model.dispose();
    assert.equal(geometryDisposals, 0, "caller owns the paper geometry");
    assert.equal(materialDisposals, 0, "caller owns the paper FBO material");
  } finally { model.dispose(); paperGeometry.dispose(); paperMaterial.dispose(); }
});

test("all model surfaces and instance transforms remain finite and index valid geometry", () => {
  for (const [name, create] of Object.entries(factories)) {
    const model = create();
    try {
      assert.equal(model.group.userData.assetStatus, "original-editable-proxy");
      const surfaces = meshes(model.group);
      assert.ok(surfaces.length > 0, `${name} has renderable surfaces`);
      for (const mesh of surfaces) {
        const position = mesh.geometry.getAttribute("position");
        assert.ok(position.count > 2, `${name}/${mesh.name} has vertices`);
        for (const attribute of Object.values(mesh.geometry.attributes)) {
          finite(attribute.array, `${name}/${mesh.name} vertex attribute`);
        }
        const indices = mesh.geometry.index;
        if (indices) for (const index of indices.array) {
          assert.ok(Number.isInteger(index) && index >= 0 && index < position.count, `${name}/${mesh.name} valid triangle index`);
        }
        if (mesh instanceof THREE.InstancedMesh) finite(mesh.instanceMatrix.array, `${name}/${mesh.name} instance matrix`);
      }
      model.group.position.set(-3, 2, 4);
      model.group.rotation.set(0.2, 0.4, -0.1);
      model.group.scale.setScalar(0.75);
      const bounds = new THREE.Box3().setFromObject(model.group);
      assert.ok(!bounds.isEmpty(), `${name} remains camera-frameable`);
      finite([...bounds.min.toArray(), ...bounds.max.toArray()], `${name} world bounds`);
    } finally { model.dispose(); }
  }
});

test("model cleanup releases shared geometry, materials, textures and instance buffers exactly once", () => {
  for (const [name, create] of Object.entries(factories)) {
    const model = create();
    const resources = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture | THREE.InstancedMesh>();
    for (const mesh of meshes(model.group)) {
      resources.add(mesh.geometry);
      if (mesh instanceof THREE.InstancedMesh) resources.add(mesh);
      for (const surface of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        resources.add(surface);
        for (const value of Object.values(surface)) if (value instanceof THREE.Texture) resources.add(value);
      }
    }
    const counts = new Map([...resources].map(resource => [resource, 0]));
    for (const resource of resources) {
      const disposed = () => counts.set(resource, counts.get(resource)! + 1);
      if (resource instanceof THREE.InstancedMesh) resource.addEventListener("dispose", disposed);
      else resource.addEventListener("dispose", disposed);
    }
    try {
      assert.ok(resources.size > 0);
      if (name === "tie") assert.ok([...resources].some(resource => resource instanceof THREE.DataTexture), "the tie owns its generated reflection texture");
      model.dispose();
      assert.equal(model.group.children.length, 0, `${name} detaches disposed meshes`);
      for (const count of counts.values()) assert.equal(count, 1, `${name} releases each shared resource`);
      model.dispose();
      for (const count of counts.values()) assert.equal(count, 1, `${name} repeated cleanup is safe`);
    } finally { model.dispose(); }
  }
});
