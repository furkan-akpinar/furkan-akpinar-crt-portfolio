import * as THREE from "three/webgpu";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

type Ring = { width: number; height: number; radius: number; y: number; z: number; taper?: number };

/**
 * Editable, original silhouette study; not Shader's computer.glb or an exact
 * SuperPET reproduction. Dimensions are in scene units, with the front at +Z.
 * The independent screen is the real camera/FBO hand-off target.
 */
export function createComputer(screenMaterial: THREE.Material) {
  const group = new THREE.Group();
  group.name = "procedural-terminal-proxy";
  group.userData.assetStatus = "original-editable-proxy";
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const instances: THREE.InstancedMesh[] = [];

  const material = (color: string, roughness = 0.65, metalness = 0) => {
    const result = new THREE.MeshStandardNodeMaterial({ color, roughness, metalness });
    materials.add(result);
    return result;
  };
  const shell = material("#62594f", 0.65);
  const lip = material("#8b7c69", 0.61);
  const face = material("#302922", 0.73);
  const recess = material("#15191a", 0.45);
  const deck = material("#b4afa0", 0.63);
  const seams = material("#555047", 0.7);
  const underside = material("#272722", 0.8);
  const keys = material("#242622", 0.34);
  const legends = material("#807e6f", 0.78);
  const screws = material("#47433a", 0.42, 0.45);

  function mesh(name: string, geometry: THREE.BufferGeometry, surface: THREE.Material, parent = group) {
    geometries.add(geometry);
    const result = new THREE.Mesh(geometry, surface);
    result.name = name;
    result.castShadow = true;
    result.receiveShadow = true;
    parent.add(result);
    return result;
  }

  function box(name: string, size: [number, number, number], position: [number, number, number], surface: THREE.Material, radius = 0.015, parent = group) {
    const result = mesh(name, new RoundedBoxGeometry(...size, 3, radius), surface, parent);
    result.position.set(...position);
    return result;
  }

  function ringPoints({ width, height, radius, y, z, taper = 0 }: Ring) {
    const points: THREE.Vector3[] = [];
    const corners = [
      [width / 2 - radius, height / 2 - radius],
      [-width / 2 + radius, height / 2 - radius],
      [-width / 2 + radius, -height / 2 + radius],
      [width / 2 - radius, -height / 2 + radius],
    ];
    for (let corner = 0; corner < 4; corner++) {
      for (let segment = 0; segment <= 8; segment++) {
        const angle = (corner + segment / 8) * Math.PI / 2;
        const localY = corners[corner][1] + Math.sin(angle) * radius;
        const localX = corners[corner][0] + Math.cos(angle) * radius;
        points.push(new THREE.Vector3(localX * (1 - taper * localY / height), localY + y, z));
      }
    }
    return points;
  }

  function bezel(name: string, outer: Ring, inner: Ring, surface: THREE.Material) {
    const a = ringPoints(outer);
    const b = ringPoints(inner);
    const vertices = [...a, ...b].flatMap((point) => [point.x, point.y, point.z]);
    const indices: number[] = [];
    for (let i = 0; i < a.length; i++) {
      const j = (i + 1) % a.length;
      indices.push(i, j, i + a.length, j, j + a.length, i + a.length);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return mesh(name, geometry, surface);
  }

  // One tapered CRT hood, sitting directly on the keyboard chassis.
  const hood = new RoundedBoxGeometry(2.48, 1.8, 1.32, 4, 0.045);
  const positions = hood.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i);
    const z = positions.getZ(i);
    const taper = 1 - 0.18 * y / 1.8 - 0.08 * (0.66 - z) / 1.32;
    positions.setX(i, positions.getX(i) * taper);
    positions.setZ(i, z * 0.48);
  }
  hood.computeVertexNormals();
  const casing = mesh("tapered-crt-hood", hood, shell);
  casing.position.set(0, 0.69, 0.3332);

  const outer = { width: 2.51, height: 1.82, radius: 0.035, y: 0.695, z: 0.81, taper: 0.18 };
  const trim = { width: 2.38, height: 1.76, radius: 0.035, y: 0.675, z: 0.825, taper: 0.18 };
  const inset = { width: 2.16, height: 1.62, radius: 0.19, y: 0.69, z: 0.768 };
  const aperture = { width: 1.947, height: 1.418, radius: 0.19, y: 0.65, z: 0.727 };
  bezel("outer-beveled-trim", outer, trim, lip);
  bezel("recessed-front-bezel", trim, inset, face);
  bezel("rounded-screen-recess", inset, aperture, recess);

  const screen = mesh("monitor-screen-camera-target", new THREE.PlaneGeometry(1.95, 1.42), screenMaterial);
  screen.position.set(0, 0.65, 0.72);
  screen.castShadow = false;
  screen.receiveShadow = false;
  screen.userData.size = { width: 1.95, height: 1.42 };

  // Separating seams and the narrow support plinth retain the integrated profile.
  box("monitor-bottom-seam", [2.64, 0.035, 0.72], [0, -0.211, 0.32], seams, 0.008);
  box("monitor-plinth", [2.52, 0.14, 0.98], [0, -0.295, 0.22], deck, 0.018);
  box("recessed-monitor-support", [2.38, 0.1, 0.74], [0, -0.415, 0.22], seams, 0.012);
  box("lower-chassis", [3.02, 0.26, 2.64], [0, -0.985, 0.8], underside, 0.022);
  const keyboardDeck = box("sloped-integrated-keyboard-deck", [3.18, 0.24, 2.6], [0, -0.76, 0.87], deck, 0.027);
  keyboardDeck.rotation.x = 0.16;

  // All keyboard details share the physical slope, so edits remain coherent.
  const keyboard = new THREE.Group();
  keyboard.name = "editable-keyboard-assembly";
  keyboard.position.copy(keyboardDeck.position);
  keyboard.rotation.copy(keyboardDeck.rotation);
  group.add(keyboard);
  // Keep keys in front of the monitor instead of concealing the upper rows
  // beneath it; the exposed stepped band is part of the integrated silhouette.
  const keyOffset = 0.22;
  box("alphabet-key-well", [2.3, 0.032, 0.81], [-0.32, 0.13, 0.395 + keyOffset], underside, 0.008, keyboard);
  box("numeric-key-well", [0.51, 0.032, 0.81], [1.19, 0.13, 0.395 + keyOffset], underside, 0.008, keyboard);

  const keyTransforms: { x: number; z: number; width: number }[] = [];
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < 13; column++) {
      keyTransforms.push({ x: -1.35 + column * 0.171 + (row % 2) * 0.02, z: 0.065 + row * 0.164, width: 1 });
    }
    for (let column = 0; column < 3; column++) {
      keyTransforms.push({ x: 1.02 + column * 0.169, z: 0.065 + row * 0.164, width: 1 });
    }
  }
  keyTransforms.push(
    { x: -1.29, z: 0.72, width: 1.6 },
    { x: -0.45, z: 0.72, width: 8.1 },
    { x: 0.4, z: 0.72, width: 1.7 },
    { x: 0.7, z: 0.72, width: 1.5 },
    { x: 1.1, z: 0.72, width: 2.1 },
    { x: 1.36, z: 0.72, width: 1 },
  );
  // The original proxy's shallow caps read as a flat black sheet. A tapered
  // shoulder gives each physical key the small rim highlight seen in the study.
  const keyGeometry = new RoundedBoxGeometry(0.145, 0.074, 0.138, 3, 0.013);
  const capPositions = keyGeometry.attributes.position;
  for (let index = 0; index < capPositions.count; index++) {
    const height = (capPositions.getY(index) + 0.037) / 0.074;
    const taper = 1 - height * 0.15;
    capPositions.setX(index, capPositions.getX(index) * taper);
    capPositions.setZ(index, capPositions.getZ(index) * taper);
  }
  keyGeometry.computeVertexNormals();
  geometries.add(keyGeometry);
  const keycaps = new THREE.InstancedMesh(keyGeometry, keys, keyTransforms.length);
  keycaps.name = "instanced-black-keycaps";
  keycaps.castShadow = true;
  keycaps.receiveShadow = true;
  const keyLegendGeometry = new THREE.PlaneGeometry(0.026, 0.008);
  geometries.add(keyLegendGeometry);
  const keyLegends = new THREE.InstancedMesh(keyLegendGeometry, legends, keyTransforms.length);
  keyLegends.name = "instanced-key-legend-marks";
  const dummy = new THREE.Object3D();
  keyTransforms.forEach(({ x, z, width }, index) => {
    dummy.position.set(x, 0.175, z + keyOffset);
    dummy.rotation.set(-0.045, 0, 0);
    dummy.scale.set(width, 1, 1);
    dummy.updateMatrix();
    keycaps.setMatrixAt(index, dummy.matrix);
    dummy.position.set(x - 0.021, 0.214, z + keyOffset - 0.018);
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    keyLegends.setMatrixAt(index, dummy.matrix);
  });
  keycaps.instanceMatrix.needsUpdate = true;
  keyLegends.instanceMatrix.needsUpdate = true;
  keyboard.add(keycaps, keyLegends);
  instances.push(keycaps, keyLegends);

  const band = box("sloped-identification-band", [2.98, 0.07, 0.38], [0, 0.15, 0.025], deck, 0.01, keyboard);
  band.rotation.x = 0.26;
  const nameplate = box("inset-identification-strip", [2.85, 0.012, 0.265], [0, 0.195, 0.05], face, 0.006, keyboard);
  nameplate.rotation.x = 0.26;
  // Original small identification texture, never sourced from the reference site.
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 96;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#24251f";
      context.fillRect(0, 0, canvas.width, canvas.height);
      ["#b84f39", "#bc843e", "#cbb252", "#657b60", "#486576"].forEach((color, index) => {
        context.fillStyle = color;
        context.fillRect(22, 21 + index * 10, 35, 7);
      });
      context.fillStyle = "#b5b09d";
      context.font = 'italic 700 53px "STIX Two Text", serif';
      context.fillText("SHADER", 73, 67);
      context.font = "17px monospace";
      context.fillStyle = "#93927e";
      context.fillText("SuperPET", 704, 41);
      context.fillText("COMPUTER", 704, 67);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      textures.add(texture);
      const plateMaterial = new THREE.MeshStandardNodeMaterial({ map: texture, roughness: 0.7 });
      materials.add(plateMaterial);
      const label = mesh("original-terminal-label", new THREE.PlaneGeometry(2.77, 0.225), plateMaterial, keyboard);
      label.position.set(0, 0.205, 0.05);
      label.rotation.x = -Math.PI / 2 + 0.26;
    }
  }

  // Repeated narrow slots on both sides and on the rear casing.
  const ventGeometry = new RoundedBoxGeometry(0.013, 0.34, 0.022, 1, 0.004);
  geometries.add(ventGeometry);
  const vents = new THREE.InstancedMesh(ventGeometry, underside, 28);
  vents.name = "side-cooling-slots";
  let ventIndex = 0;
  for (const side of [-1, 1]) {
    for (let slot = 0; slot < 14; slot++) {
      const originalZ = -0.48 + slot * 0.057;
      const z = 0.65 + (originalZ - 0.65) * 0.48;
      const sideWidth = 1.24 * (1 - 0.18 * (0.32 - 0.69) / 1.8 - 0.08 * (0.66 - (originalZ + 0.01)) / 1.32);
      dummy.position.set(side * (sideWidth + 0.007), 0.32, z);
      dummy.rotation.set(0, 0, side * 0.04);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      vents.setMatrixAt(ventIndex++, dummy.matrix);
    }
  }
  vents.instanceMatrix.needsUpdate = true;
  group.add(vents);
  instances.push(vents);
  box("rear-vent-panel", [1.55, 0.43, 0.026], [0, 0.49, 0.012], underside, 0.012);
  for (let i = 0; i < 10; i++) {
    box(`rear-vent-rib-${i}`, [0.041, 0.405, 0.025], [-0.66 + i * 0.147, 0.49, -0.008], shell, 0.005);
  }
  for (const x of [-1.23, 1.23]) {
    for (const z of [-0.18, 1.7]) {
      box("rubber-foot", [0.23, 0.065, 0.22], [x, -1.14, z], underside, 0.02);
    }
  }
  for (const x of [-1.43, 1.43]) {
    const screw = mesh("chassis-fastener", new THREE.CylinderGeometry(0.016, 0.016, 0.006, 8), screws, keyboard);
    screw.position.set(x, 0.124, 1.09);
  }

  group.updateMatrixWorld(true);
  let disposed = false;
  return {
    group,
    screen,
    dispose() {
      if (disposed) return;
      disposed = true;
      instances.forEach((instance) => instance.dispose());
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((surface) => surface.dispose());
      textures.forEach((texture) => texture.dispose());
      group.clear();
      // The supplied screen material belongs to the FBO pipeline, not this asset.
    },
  };
}
