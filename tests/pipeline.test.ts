import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three/webgpu";
import { scenes, getSceneState } from "../src/config/scenes.ts";
import { sceneScrollTop, SCROLL_SCREENS, heroTravel } from "../src/components/scene/runtime.ts";
import { createComputer } from "../src/components/scene/computer-model.ts";

function close(actual: number, expected: number, message: string) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: expected ${expected}, received ${actual}`);
}

function vectorClose(actual: THREE.Vector3, expected: THREE.Vector3, message: string) {
  close(actual.distanceTo(expected), 0, message);
}

test("menu destinations survive native integer scroll rounding at both viewports", () => {
  for (const height of [844,900]) {
    for (const scene of scenes) {
      const scroll=Math.round(sceneScrollTop(scene.id,height));
      assert.equal(getSceneState(scroll/(SCROLL_SCREENS*height)).scene.id,scene.id);
    }
  }
});

test("legacy office navigation resolves to the direct About destination", () => {
  assert.equal(sceneScrollTop('office', 900), sceneScrollTop('about-us', 900));
});

test("hero camera travel is bounded across overscroll, scene boundaries and invalid input", () => {
  const heroEnd = scenes[0].end;
  assert.equal(heroTravel(-0.2), 0);
  assert.equal(heroTravel(0), 0);
  close(heroTravel(heroEnd / 2), 0.5, "halfway through the hero span");
  assert.equal(heroTravel(heroEnd), 1);
  assert.equal(heroTravel(0.7), 1);
  assert.equal(heroTravel(2), 1);
  assert.equal(heroTravel(Number.NaN), 0);
  assert.equal(heroTravel(Number.POSITIVE_INFINITY), 0);
});

test("the monitor exposes its physical screen dimensions, center and front-facing surface", () => {
  const screenMaterial = new THREE.MeshBasicNodeMaterial();
  const computer = createComputer(screenMaterial);
  try {
    const { screen } = computer;
    assert.equal(screen.parent, computer.group);
    assert.equal(screen.material, screenMaterial);
    assert.equal(screen.name, "monitor-screen-camera-target");
    assert.deepEqual(screen.userData.size, { width: 1.95, height: 1.42 });
    screen.geometry.computeBoundingBox();
    const dimensions = screen.geometry.boundingBox!.getSize(new THREE.Vector3());
    vectorClose(dimensions, new THREE.Vector3(1.95, 1.42, 0), "screen geometry agrees with the camera/FBO size contract");
    vectorClose(screen.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(0, 0.65, 0.72), "screen center");
    const normals = screen.geometry.getAttribute("normal");
    for (let vertex = 0; vertex < normals.count; vertex++) {
      vectorClose(new THREE.Vector3().fromBufferAttribute(normals, vertex), new THREE.Vector3(0, 0, 1), "screen front points toward local +Z");
    }
  } finally {
    computer.dispose();
    screenMaterial.dispose();
  }
});

test("a moved and rotated terminal supplies a world-space screen endpoint instead of a fixed camera box", () => {
  const screenMaterial = new THREE.MeshBasicNodeMaterial();
  const computer = createComputer(screenMaterial);
  try {
    computer.group.position.set(3, -2, 5);
    computer.group.rotation.y = Math.PI / 2;
    computer.group.scale.setScalar(1.5);
    computer.group.updateMatrixWorld(true);

    const center = computer.screen.getWorldPosition(new THREE.Vector3());
    vectorClose(center, new THREE.Vector3(4.08, -1.025, 5), "world screen center follows terminal transform");
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(computer.screen.getWorldQuaternion(new THREE.Quaternion()));
    vectorClose(normal, new THREE.Vector3(1, 0, 0), "front direction follows screen rotation");
    const endpoint = center.clone().addScaledVector(normal, 2);
    vectorClose(endpoint, new THREE.Vector3(6.08, -1.025, 5), "a camera two world units in front reaches the rotated screen");
    const screenLocalEndpoint = computer.screen.worldToLocal(endpoint.clone());
    vectorClose(screenLocalEndpoint, new THREE.Vector3(0, 0, 4 / 3), "endpoint lies on the screen's local positive normal");
  } finally {
    computer.dispose();
    screenMaterial.dispose();
  }
});

test("disposing the terminal releases owned resources once and preserves the external FBO screen material", () => {
  const externalTexture = new THREE.Texture();
  const screenMaterial = new THREE.MeshBasicNodeMaterial({ map: externalTexture });
  const computer = createComputer(screenMaterial);
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  computer.group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const surface of Array.isArray(object.material) ? object.material : [object.material]) {
      if (surface !== screenMaterial) materials.add(surface);
    }
  });
  assert.ok(geometries.size > 0, "the terminal owns geometry");
  assert.ok(materials.size > 0, "the terminal owns casing and keyboard materials");

  const disposalCounts = new Map<THREE.BufferGeometry | THREE.Material, number>();
  for (const resource of [...geometries, ...materials]) {
    disposalCounts.set(resource, 0);
    resource.addEventListener("dispose", () => disposalCounts.set(resource, disposalCounts.get(resource)! + 1));
  }
  let externalMaterialDisposals = 0;
  let externalTextureDisposals = 0;
  screenMaterial.addEventListener("dispose", () => externalMaterialDisposals++);
  externalTexture.addEventListener("dispose", () => externalTextureDisposals++);
  try {
    computer.dispose();
    assert.equal(computer.group.children.length, 0, "disposed meshes detach from the scene");
    for (const count of disposalCounts.values()) assert.equal(count, 1, "each owned resource is disposed");
    assert.equal(externalMaterialDisposals, 0, "FBO pipeline retains ownership of the supplied material");
    assert.equal(externalTextureDisposals, 0, "FBO pipeline retains ownership of the supplied texture");
    computer.dispose();
    for (const count of disposalCounts.values()) assert.equal(count, 1, "repeat cleanup is safe");
    assert.equal(externalMaterialDisposals, 0);
    assert.equal(externalTextureDisposals, 0);
  } finally {
    computer.dispose();
    screenMaterial.dispose();
    externalTexture.dispose();
  }
});
