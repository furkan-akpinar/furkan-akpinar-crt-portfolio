import * as THREE from "three/webgpu";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

type Placement = { position: THREE.Vector3; rotation?: THREE.Euler; scale?: THREE.Vector3 };

/** Original editable studies from the captured silhouettes, not the source assets. */
function modelResources(name: string) {
  const group = new THREE.Group();
  group.name = name;
  group.userData.assetStatus = "original-editable-proxy";
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const instances = new Set<THREE.InstancedMesh>();
  function material(color: string, roughness = 0.65, metalness = 0) {
    const result = new THREE.MeshStandardNodeMaterial({ color, roughness, metalness });
    materials.add(result);
    return result;
  }
  function mesh(name: string, geometry: THREE.BufferGeometry, surface: THREE.Material, parent = group) {
    geometries.add(geometry);
    const item = new THREE.Mesh(geometry, surface);
    item.name = name;
    item.castShadow = true;
    item.receiveShadow = true;
    parent.add(item);
    return item;
  }
  function box(name: string, size: [number, number, number], position: [number, number, number], surface: THREE.Material, radius = 0.015, parent = group) {
    const item = mesh(name, new RoundedBoxGeometry(...size, 2, radius), surface, parent);
    item.position.set(...position);
    return item;
  }
  function instanced(name: string, geometry: THREE.BufferGeometry, surface: THREE.Material, placements: Placement[], parent = group) {
    geometries.add(geometry);
    const item = new THREE.InstancedMesh(geometry, surface, placements.length);
    item.name = name;
    item.castShadow = true;
    item.receiveShadow = true;
    const transform = new THREE.Object3D();
    placements.forEach((placement, index) => {
      transform.position.copy(placement.position);
      transform.rotation.copy(placement.rotation ?? new THREE.Euler());
      transform.scale.copy(placement.scale ?? new THREE.Vector3(1, 1, 1));
      transform.updateMatrix();
      item.setMatrixAt(index, transform.matrix);
    });
    item.instanceMatrix.needsUpdate = true;
    item.computeBoundingSphere();
    instances.add(item);
    parent.add(item);
    return item;
  }
  let disposed = false;
  return {
    group, geometries, materials, textures, material, mesh, box, instanced,
    dispose() {
      if (disposed) return;
      disposed = true;
      instances.forEach((item) => item.dispose());
      geometries.forEach((item) => item.dispose());
      materials.forEach((item) => item.dispose());
      textures.forEach((item) => item.dispose());
      group.clear();
    },
  };
}

/**
 * Cubicle field observed in reference-round2/desktop-04.png.
 * Y is up. Desk/chair fronts face +Z in even rows and -Z in odd rows.
 * Default floor: 23 × 27 units. Highest partition/CRT: about 2.25 units.
 * A camera near (10, 13, 18), looking at (0, 1, 0), gives an oblique overview.
 */
export function createOffice(options: { columns?: number; rows?: number } = {}) {
  const r = modelResources("procedural-office-cubicles");
  const columns = Math.min(10, Math.max(2, Math.round(options.columns ?? 7)));
  const rows = Math.min(10, Math.max(2, Math.round(options.rows ?? 6)));
  const wall = r.material("#9f9f9a", 0.94);
  const wallEdge = r.material("#c0bfb7", 0.73);
  const table = r.material("#d4d1c2", 0.56);
  const beige = r.material("#bab8a0", 0.68);
  const keycap = r.material("#888c80", 0.8);
  const glass = r.material("#192626", 0.31);
  const black = r.material("#202322", 0.88);
  const chairSeat = r.material("#41413e", 0.92);
  const steel = r.material("#696e64", 0.46, 0.4);
  const paper = r.material("#dad9c5", 0.98);
  const binder = r.material("#30372f", 0.86);
  const floor = r.material("#5d5e5b", 0.99);
  const floorWidth = columns * 3 + 2;
  const floorDepth = rows * 4.15 + 2;
  r.box("carpet-floor", [floorWidth, 0.06, floorDepth], [0, -0.045, 0], floor, 0.01);

  type Part = { name: string; geometry: THREE.BufferGeometry; surface: THREE.Material; placements: Placement[] };
  const parts: Part[] = [];
  const part = (name: string, geometry: THREE.BufferGeometry, surface: THREE.Material) => {
    const result: Part = { name, geometry, surface, placements: [] };
    parts.push(result);
    return result;
  };
  const cube = (name: string, dimensions: [number, number, number], surface: THREE.Material, radius = 0.012) =>
    part(name, radius < 0.007 ? new THREE.BoxGeometry(...dimensions) : new RoundedBoxGeometry(...dimensions, 2, radius), surface);
  const desk = cube("instanced-desk-tops", [2.8, 0.095, 1.36], table);
  const legs = cube("instanced-desk-legs", [0.06, 1.12, 0.06], steel, 0.005);
  const backs = cube("instanced-cubicle-back-panels", [2.88, 2.14, 0.065], wall, 0.006);
  const sides = cube("instanced-cubicle-side-panels", [0.06, 2.14, 1.4], wall, 0.006);
  const trims = cube("instanced-partition-top-rails", [2.9, 0.026, 0.085], wallEdge, 0.004);
  const cases = cube("instanced-desktop-computer-cases", [0.91, 0.15, 0.63], beige, 0.014);
  const monitor = cube("instanced-beige-crt-shells", [0.77, 0.67, 0.52], beige, 0.025);
  const screenFrame = cube("instanced-inset-crt-bezels", [0.651, 0.528, 0.025], keycap, 0.018);
  const screen = cube("instanced-dark-crt-glass", [0.573, 0.452, 0.021], glass, 0.025);
  const stems = cube("instanced-crt-supports", [0.26, 0.115, 0.3], beige);
  const monitorLip = cube("instanced-crt-lower-bezels", [0.67, 0.036, 0.025], keycap, 0.002);
  const boards = cube("instanced-keyboard-plates", [0.87, 0.038, 0.285], beige, 0.009);
  const smallKeys = cube("instanced-keyboard-keys", [0.038, 0.012, 0.033], keycap, 0.002);
  const mice = part("instanced-mice", new THREE.SphereGeometry(1, 10, 8), beige);
  const cables = part("instanced-mouse-cables", new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.74, 1.205, 0.26), new THREE.Vector3(0.89, 1.205, 0.02),
    new THREE.Vector3(0.91, 1.205, -0.21), new THREE.Vector3(0.56, 1.205, -0.36),
  ]), 12, 0.005, 4, false), black);
  const binders = cube("instanced-upright-binders", [0.095, 0.5, 0.34], binder, 0.003);
  const binderLines = cube("instanced-binder-spines", [0.016, 0.37, 0.006], keycap, 0.001);
  const papers = cube("instanced-desk-paper", [0.34, 0.005, 0.25], paper, 0.001);
  const notices = cube("instanced-pinned-notes", [0.2, 0.25, 0.006], paper, 0.001);
  const mugs = part("instanced-mugs", new THREE.CylinderGeometry(0.056, 0.049, 0.13, 10), black);
  const seatGeometry = new THREE.SphereGeometry(1, 24, 16);
  const seatVertices = seatGeometry.attributes.position;
  for (let index = 0; index < seatVertices.count; index++) {
    const x = seatVertices.getX(index), y = seatVertices.getY(index), z = seatVertices.getZ(index);
    // A rounded, slightly dished cushion, rather than the old square slab.
    seatVertices.setXYZ(index, Math.sign(x) * Math.sqrt(Math.abs(x)) * 0.41 * (1 - z * 0.07), y * 0.085 - Math.max(0, y) * (1 - x * x - z * z) * 0.018, Math.sign(z) * Math.sqrt(Math.abs(z)) * 0.36);
  }
  seatGeometry.computeVertexNormals();
  const seat = part("instanced-chair-seat-cushions", seatGeometry, chairSeat);
  const backGeometry = new THREE.SphereGeometry(1, 24, 18);
  const backVertices = backGeometry.attributes.position;
  for (let index = 0; index < backVertices.count; index++) {
    const y = backVertices.getY(index);
    backVertices.setX(index, backVertices.getX(index) * (1 - y * 0.23));
  }
  backGeometry.computeVertexNormals();
  const seatBack = part("instanced-chair-back-cushions", backGeometry, black);
  const backSupport = cube("instanced-chair-back-support", [0.07, 0.63, 0.06], steel, 0.005);
  const armrests = cube("instanced-chair-armrests", [0.095, 0.085, 0.48], wallEdge, 0.025);
  const armSupports = cube("instanced-chair-arm-supports", [0.045, 0.3, 0.045], steel, 0.005);
  const chairStem = part("instanced-chair-pedestals", new THREE.CylinderGeometry(0.045, 0.06, 0.46, 10), steel);
  const spokes = cube("instanced-chair-base-spokes", [0.044, 0.05, 0.44], steel, 0.008);
  const wheels = part("instanced-chair-casters", new THREE.SphereGeometry(0.045, 8, 6), black);
  const cells: { center: THREE.Vector3; rotation: number }[] = [];
  const offset = new THREE.Vector3();
  const rotate = new THREE.Quaternion();
  function place(target: Part, cell: { center: THREE.Vector3; rotation: number }, x: number, y: number, z: number, scale?: [number, number, number], pitch = 0, yaw = 0) {
    rotate.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, cell.rotation);
    offset.set(x, y, z).applyQuaternion(rotate).add(cell.center);
    target.placements.push({ position: offset.clone(), rotation: new THREE.Euler(pitch, cell.rotation + yaw, 0), scale: scale ? new THREE.Vector3(...scale) : undefined });
  }
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const cell = { center: new THREE.Vector3((column - (columns - 1) / 2) * 3, 0, (row - (rows - 1) / 2) * 4.15), rotation: row % 2 ? Math.PI : 0 };
      cells.push(cell);
      place(desk, cell, 0, 1.15, -0.23);
      place(backs, cell, 0, 1.1, -0.95);
      place(sides, cell, -1.44, 1.1, -0.265);
      place(trims, cell, 0, 2.183, -0.95);
      for (const x of [-1.3, 1.3]) for (const z of [-0.82, 0.36]) place(legs, cell, x, 0.56, z);
      place(cases, cell, -0.04, 1.265, -0.33);
      place(stems, cell, -0.04, 1.4, -0.38);
      place(monitor, cell, -0.04, 1.785, -0.44);
      place(screenFrame, cell, -0.04, 1.8, -0.169);
      place(screen, cell, -0.04, 1.8, -0.15);
      place(monitorLip, cell, -0.04, 1.5, -0.165);
      place(boards, cell, -0.04, 1.218, 0.205, undefined, 0.08);
      for (let keyRow = 0; keyRow < 4; keyRow++) for (let keyColumn = 0; keyColumn < 16; keyColumn++) {
        place(smallKeys, cell, -0.408 + keyColumn * 0.047, 1.24, 0.108 + keyRow * 0.049);
      }
      place(mice, cell, 0.735, 1.237, 0.31, [0.07, 0.04, 0.1]);
      place(cables, cell, 0, 0, 0);
      for (let n = 0; n < 3; n++) {
        const x = -1.035 + n * 0.108;
        place(binders, cell, x, 1.447, -0.45);
        place(binderLines, cell, x - 0.03, 1.456, -0.276);
      }
      place(papers, cell, -0.88, 1.204, 0.22, undefined, 0, 0.19);
      place(papers, cell, -0.78, 1.209, 0.29, undefined, 0, -0.12);
      place(notices, cell, 0.61, 1.64, -0.911);
      place(notices, cell, -0.64, 1.8, -0.911);
      place(mugs, cell, 0.75, 1.266, -0.33);
      const chairZ = 1.35 + ((row + column) % 3 - 1) * 0.09;
      place(seat, cell, 0.1, 0.68, chairZ);
      place(seatBack, cell, 0.1, 1.28, chairZ + 0.33, [0.375, 0.455, 0.105], -0.13);
      place(backSupport, cell, 0.1, 0.94, chairZ + 0.355);
      place(chairStem, cell, 0.1, 0.38, chairZ);
      for (const side of [-1, 1]) {
        place(armrests, cell, 0.1 + side * 0.465, 0.98, chairZ - 0.025);
        place(armSupports, cell, 0.1 + side * 0.435, 0.81, chairZ + 0.055);
      }
      for (let leg = 0; leg < 5; leg++) {
        const angle = leg / 5 * Math.PI * 2;
        place(spokes, cell, 0.1 + Math.sin(angle) * 0.21, 0.115, chairZ + Math.cos(angle) * 0.21, undefined, 0, angle);
        place(wheels, cell, 0.1 + Math.sin(angle) * 0.4, 0.067, chairZ + Math.cos(angle) * 0.4);
      }
    }
  }
  parts.forEach(({ name, geometry, surface, placements }) => r.instanced(name, geometry, surface, placements));
  r.group.userData.referenceCapture = "reference-round2/desktop-04.png";
  return { group: r.group, cells, focus: new THREE.Vector3(0, 1, 0), dispose: r.dispose };
}

/** A horizontal feed beam, not a household waste-bin shredder. Paper is caller-owned. */
export function createShredder(width = 12) {
  const r = modelResources("procedural-horizontal-shredder");
  const span = Math.max(4, width);
  const metal = r.material("#a6a791", 0.38, 0.62);
  const edge = r.material("#d2cfb1", 0.28, 0.65);
  const dark = r.material("#252924", 0.6, 0.25);
  const button = r.material("#b7b9a1", 0.45, 0.4);
  r.box("long-feed-housing", [span, 0.49, 0.32], [0, 0, 0], metal, 0.025);
  r.box("upper-feed-lip", [span, 0.045, 0.38], [0, 0.254, 0.022], edge, 0.009);
  r.box("lower-feed-lip", [span, 0.029, 0.355], [0, -0.25, 0.008], dark, 0.006);
  r.box("paper-entry-slot", [span - 0.12, 0.035, 0.017], [0, 0.199, 0.17], dark, 0.004);
  r.box("central-identification-plate", [0.84, 0.23, 0.021], [0, -0.005, 0.174], dark, 0.013);
  for (const side of [-1, 1]) {
    for (let index = 0; index < 3; index++) {
      r.box("recessed-vertical-control", [0.095, 0.295, 0.029], [side * (0.57 + index * 0.15), -0.004, 0.18], button, 0.014);
    }
    r.box("narrow-status-display", [0.074, 0.31, 0.02], [side * 1.34, 0, 0.181], dark, 0.004);
    for (let n = 0; n < 5; n++) {
      const indicator = new THREE.MeshBasicNodeMaterial({ color: n % 2 ? "#d7d9b5" : "#566d69" });
      r.materials.add(indicator);
      r.box("status-light", [0.031, 0.025, 0.008], [side * 1.34, 0.11 - n * 0.051, 0.196], indicator, 0.002);
    }
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#171c19"; ctx.fillRect(0, 0, 512, 128);
      ctx.fillStyle = "#dadbc4"; ctx.font = "italic bold 64px Georgia, serif";
      ctx.textAlign = "center"; ctx.fillText("STUDIO", 256, 86);
      const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
      r.textures.add(map);
      const labelMaterial = new THREE.MeshBasicNodeMaterial({ map }); r.materials.add(labelMaterial);
      const label = r.mesh("original-feed-label", new THREE.PlaneGeometry(0.76, 0.19), labelMaterial);
      label.position.set(0, -0.007, 0.19);
    }
  }
  const roller = new THREE.Group(); roller.name = "animatable-feed-roller"; r.group.add(roller);
  const shaft = r.mesh("feed-shaft", new THREE.CylinderGeometry(0.062, 0.062, span - 0.16, 12), dark, roller);
  shaft.rotation.z = Math.PI / 2; roller.position.set(0, -0.225, -0.065);
  r.group.userData.referenceCapture = "reference-round2/desktop-16.png";
  return { group: r.group, roller, intake: new THREE.Vector3(0, 0.25, 0), width: span, dispose: r.dispose };
}

/** Small original studio-light environment, authored numerically for polished gold. */
function reflectionMap() {
  const width = 128, height = 64;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width, v = y / height;
      const panel = (cx: number, cy: number, sx: number, sy: number) => Math.exp(-(((u - cx) / sx) ** 2) - ((v - cy) / sy) ** 2);
      const light = Math.min(1, 0.055 + panel(0.23, 0.36, 0.022, 0.27) * 1.1 + panel(0.73, 0.5, 0.04, 0.22) * 0.85 + panel(0.5, 0.15, 0.3, 0.07) * 0.8);
      const i = (y * width + x) * 4;
      data[i] = light * 255;
      data[i + 1] = light * 249;
      data[i + 2] = light * 229;
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, width, height);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Gold tie silhouette from reference-round2/desktop-24 and desktop-28.
 * Front is +Z, knot around y=1.55, pointed blade ends y=-2.08.
 * The slight S bend and shallow folds are geometry, editable independently.
 */
export function createTie() {
  const r = modelResources("procedural-golden-tie");
  const environment = reflectionMap(); r.textures.add(environment);
  const gold = new THREE.MeshPhysicalNodeMaterial({ color: "#b7a67c", metalness: 0.96, roughness: 0.21, clearcoat: 0.3, clearcoatRoughness: 0.18, envMap: environment, envMapIntensity: 1.55, side: THREE.DoubleSide });
  r.materials.add(gold);
  const columns = 20, rows = 100;
  const vertices: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let row = 0; row <= rows; row++) {
    const t = row / rows;
    const halfWidth = t < 0.87 ? 0.155 + 0.27 * Math.sin(t / 0.87 * Math.PI / 2) : 0.425 * (1 - t) / 0.13;
    const centerX = Math.sin(t * 5.2) * 0.065;
    const centerZ = Math.sin(t * 5.8) * 0.065;
    for (let column = 0; column <= columns; column++) {
      const across = column / columns * 2 - 1;
      const x = centerX + across * halfWidth;
      const y = 1.34 - t * 3.42;
      const diagonalFold = Math.exp(-(((t - 0.4 - across * 0.065) / 0.085) ** 2)) * 0.055;
      const lowerFold = Math.exp(-(((t - 0.77 + across * 0.06) / 0.11) ** 2)) * 0.046;
      const z = centerZ + (1 - across * across) * (0.033 + 0.026 * Math.sin(t * 12) + diagonalFold - lowerFold) + across * Math.sin(t * 7) * 0.03;
      vertices.push(x, y, z); uvs.push(column / columns, 1 - t);
      if (row < rows && column < columns) {
        const a = row * (columns + 1) + column, b = a + columns + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  // A thin closed ribbon retains an edge when the tie turns; the earlier blade
  // was a zero-thickness sheet. Its front contour and camera scale remain editable.
  const frontVertexCount = vertices.length / 3;
  const frontIndices = [...indices];
  for (let index = 0; index < frontVertexCount; index++) {
    vertices.push(vertices[index * 3], vertices[index * 3 + 1], vertices[index * 3 + 2] - 0.022);
    uvs.push(uvs[index * 2], uvs[index * 2 + 1]);
  }
  for (let index = 0; index < frontIndices.length; index += 3) {
    indices.push(frontIndices[index] + frontVertexCount, frontIndices[index + 2] + frontVertexCount, frontIndices[index + 1] + frontVertexCount);
  }
  for (let row = 0; row < rows; row++) {
    for (const column of [0, columns]) {
      const a = row * (columns + 1) + column, b = a + columns + 1;
      if (column === 0) indices.push(a, a + frontVertexCount, b, b, a + frontVertexCount, b + frontVertexCount);
      else indices.push(a, b, a + frontVertexCount, b, b + frontVertexCount, a + frontVertexCount);
    }
  }
  for (const row of [0, rows]) {
    for (let column = 0; column < columns; column++) {
      const a = row * (columns + 1) + column, b = a + 1;
      indices.push(a, b, a + frontVertexCount, b, b + frontVertexCount, a + frontVertexCount);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const blade = r.mesh("animatable-curved-tie-blade", geometry, gold);

  const knotVertices: number[] = [], knotIndices: number[] = [];
  const ringSegments = 24, knotRows = 14;
  for (let row = 0; row <= knotRows; row++) {
    const t = row / knotRows;
    const width = 0.15 + t * 0.125 + Math.sin(t * Math.PI) * 0.02;
    for (let segment = 0; segment <= ringSegments; segment++) {
      const angle = segment / ringSegments * Math.PI * 2;
      const a = Math.cos(angle), b = Math.sin(angle);
      knotVertices.push(Math.sign(a) * Math.sqrt(Math.abs(a)) * width, 1.29 + t * 0.42, Math.sign(b) * Math.sqrt(Math.abs(b)) * (0.12 + t * 0.015));
      if (row < knotRows && segment < ringSegments) {
        const n = row * (ringSegments + 1) + segment;
        knotIndices.push(n, n + 1, n + ringSegments + 1, n + 1, n + ringSegments + 2, n + ringSegments + 1);
      }
    }
  }
  const knotGeometry = new THREE.BufferGeometry();
  knotGeometry.setAttribute("position", new THREE.Float32BufferAttribute(knotVertices, 3));
  knotGeometry.setIndex(knotIndices); knotGeometry.computeVertexNormals();
  const knot = r.mesh("animatable-tie-knot", knotGeometry, gold);
  const neckLoop = new THREE.Group(); neckLoop.name = "tie-neck-strap"; r.group.add(neckLoop);
  for (const side of [-1, 1]) {
    const strapVertices: number[] = [], strapIndices: number[] = [];
    const strapSegments = 18, strapRingSegments = 16;
    for (let step = 0; step <= strapSegments; step++) {
      const t = step / strapSegments;
      const y = 1.62 + t * (side < 0 ? 0.17 : 0.35) + Math.sin(t * Math.PI) * 0.065;
      const z = -0.08 - Math.sin(t * Math.PI) * 0.16;
      const halfHeight = 0.068 + Math.sin(t * Math.PI) * 0.027;
      // Preserve the measured center path/endpoints, but round the thin cross
      // section so its edge can catch light instead of vanishing as a dark plane.
      for (let segment = 0; segment <= strapRingSegments; segment++) {
        const angle = segment / strapRingSegments * Math.PI * 2;
        const across = Math.cos(angle);
        strapVertices.push(side * (0.155 + t * 0.49), y + across * halfHeight, z + across * Math.sin(t * 3.7) * 0.035 + Math.sin(angle) * 0.024);
        if (step < strapSegments && segment < strapRingSegments) {
          const a = step * (strapRingSegments + 1) + segment, b = a + strapRingSegments + 1;
          if (side > 0) strapIndices.push(a, a + 1, b, a + 1, b + 1, b);
          else strapIndices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    }
    for (const step of [0, strapSegments]) {
      const t = step / strapSegments;
      const center = strapVertices.length / 3;
      strapVertices.push(side * (0.155 + t * 0.49), 1.62 + t * (side < 0 ? 0.17 : 0.35), -0.08);
      for (let segment = 0; segment < strapRingSegments; segment++) {
        const a = step * (strapRingSegments + 1) + segment;
        if ((step === strapSegments) === (side > 0)) strapIndices.push(center, a, a + 1);
        else strapIndices.push(center, a + 1, a);
      }
    }
    const strapGeometry = new THREE.BufferGeometry();
    strapGeometry.setAttribute("position", new THREE.Float32BufferAttribute(strapVertices, 3));
    strapGeometry.setIndex(strapIndices); strapGeometry.computeVertexNormals();
    r.mesh("curved-open-neck-strap", strapGeometry, gold, neckLoop);
  }
  r.group.userData.referenceCapture = "reference-round2/desktop-28.png";
  return { group: r.group, blade, knot, neckLoop, dispose: r.dispose };
}

/**
 * Three narrow curved office phones observed in desktop-34 through desktop-37.
 * Closed receivers run along Z; each pivot is at its front mouthpiece. The
 * middle receiver starts raised and turned over to expose its twelve keys.
 * Returned baselines must be used when applying motion (do not accumulate it).
 */
export function createPhones() {
  const r = modelResources("procedural-three-office-phones");
  const plastic = r.material("#cbc6b2", 0.36, 0.02);
  const edge = r.material("#a6a28d", 0.64);
  const black = r.material("#242a27", 0.76);
  const chrome = r.material("#bbbcb0", 0.3, 0.76);
  const keyLegend = new THREE.MeshBasicNodeMaterial({ color: "#dddccc" });
  r.materials.add(keyLegend);
  const phones: THREE.Group[] = [];
  const handsets: THREE.Group[] = [];
  const baseTop = (z: number) => 0.45 - z * 0.1;
  const handleY = (t: number) => 0.33 * t + Math.sin(t * Math.PI) * 0.19;
  const handleLength = 2.28;

  function receiverGeometry() {
    const positions: number[] = [], indices: number[] = [];
    const lengthSegments = 38, ringSegments = 20;
    for (let row = 0; row <= lengthSegments; row++) {
      const t = row / lengthSegments;
      // The observed receiver has broad end caps and a narrower grip. Keep
      // its old maximum envelope and length so the contact framing is retained.
      const halfWidth = 0.282 + 0.057 * (Math.exp(-(((t - 0.09) / 0.19) ** 2)) + Math.exp(-(((t - 0.9) / 0.19) ** 2)));
      const halfDepth = 0.105 + Math.abs(t - 0.5) * 0.022;
      for (let segment = 0; segment <= ringSegments; segment++) {
        const angle = segment / ringSegments * Math.PI * 2;
        const cosine = Math.cos(angle), sine = Math.sin(angle);
        positions.push(Math.sign(cosine) * Math.pow(Math.abs(cosine), 0.48) * halfWidth, handleY(t) + Math.sign(sine) * Math.pow(Math.abs(sine), 0.48) * halfDepth, -t * handleLength);
        if (row < lengthSegments && segment < ringSegments) {
          const n = row * (ringSegments + 1) + segment;
          indices.push(n, n + ringSegments + 1, n + 1, n + 1, n + ringSegments + 1, n + ringSegments + 2);
        }
      }
    }
    // Close both ends of the hollow loft with matching rounded end faces.
    for (const row of [0, lengthSegments]) {
      const t = row / lengthSegments;
      const center = positions.length / 3;
      positions.push(0, handleY(t), -t * handleLength);
      for (let segment = 0; segment < ringSegments; segment++) {
        const n = row * (ringSegments + 1) + segment;
        if (row === 0) indices.push(center, n, n + 1);
        else indices.push(center, n + 1, n);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    return geometry;
  }
  const receiver = receiverGeometry();
  const keybedVertices: number[] = [], keybedIndices: number[] = [];
  for (let row = 0; row <= 16; row++) {
    const t = 0.4 + row / 16 * 0.29;
    for (const x of [-0.226, 0.226]) keybedVertices.push(x, handleY(t) - 0.115, -t * handleLength);
    if (row < 16) { const n = row * 2; keybedIndices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3); }
  }
  const keybed = new THREE.BufferGeometry();
  keybed.setAttribute("position", new THREE.Float32BufferAttribute(keybedVertices, 3));
  keybed.setIndex(keybedIndices); keybed.computeVertexNormals();
  const holesGeometry = new THREE.CircleGeometry(0.012, 8);
  const digitGeometry = new RoundedBoxGeometry(0.098, 0.027, 0.106, 1, 0.009);
  const functionGeometry = new RoundedBoxGeometry(0.114, 0.023, 0.045, 1, 0.006);
  const legendGeometry = new THREE.PlaneGeometry(0.032, 0.039);
  for (let index = 0; index < 3; index++) {
    const phone = new THREE.Group(); phone.name = `office-phone-${index + 1}`;
    phones.push(phone); r.group.add(phone);
    const narrow = index === 0;
    const width = narrow ? 1.04 : 1.85;
    const handsetX = narrow ? 0 : -0.39;
    const baseGeometry = new RoundedBoxGeometry(width, 0.4, 2.8, 3, 0.025);
    const attribute = baseGeometry.attributes.position;
    for (let vertex = 0; vertex < attribute.count; vertex++) {
      const y = attribute.getY(vertex), z = attribute.getZ(vertex);
      attribute.setY(vertex, y - z * 0.1 * (y + 0.2) / 0.4);
    }
    baseGeometry.computeVertexNormals();
    const base = r.mesh("sloped-telephone-base", baseGeometry, plastic, phone); base.position.y = 0.25;
    r.box("dark-base-plinth", [width - 0.05, 0.1, 2.7], [0, 0.075, 0], black, 0.018, phone);
    const recess = r.box("receiver-cradle-recess", [0.8, 0.027, 2.41], [handsetX, 0.433, -0.015], edge, 0.012, phone);
    recess.rotation.x = 0.1;
    for (const side of [-1, 1]) {
      const lip = r.box("receiver-cradle-edge", [0.055, 0.06, 2.4], [handsetX + side * 0.413, 0.448, -0.005], plastic, 0.012, phone);
      lip.rotation.x = 0.1;
    }
    r.box("front-cradle-stop", [0.87, 0.1, 0.075], [handsetX, 0.368, 1.23], plastic, 0.014, phone);
    const handset = new THREE.Group(); handset.name = `pivotable-handset-${index + 1}`;
    handset.position.set(handsetX, 0.51, 1.105);
    if (index === 1) handset.rotation.set(1.25, 0, Math.PI);
    phone.add(handset); handsets.push(handset);
    r.mesh("curved-receiver-shell", receiver, plastic, handset);
    r.mesh("recessed-receiver-key-panel", keybed, edge, handset);
    const earpiece = r.box("raised-rounded-inner-earpiece", [0.586, 0.052, 0.43], [0, handleY(0.88) - 0.124, -0.88 * handleLength], plastic, 0.025, handset);
    earpiece.rotation.x = -0.096;
    const mouthpiece = r.box("rounded-inner-mouthpiece", [0.535, 0.029, 0.26], [0, handleY(0.12) - 0.119, -0.12 * handleLength], plastic, 0.014, handset);
    mouthpiece.rotation.x = 0.39;
    const holes: Placement[] = [];
    // Mouthpiece perforations on both sides, plus the receiver's inner earpiece.
    for (const surface of [-1, 1]) {
      for (const center of surface === -1 ? [0.12, 0.865] : [0.17]) {
        for (let row = 0; row < 4; row++) for (let column = 0; column < 3; column++) {
          const t = center + (row - 1.5) * 0.018;
          const surfaceDepth = surface === 1 ? 0.117 : center > 0.7 ? 0.155 : 0.14;
          holes.push({ position: new THREE.Vector3((column - 1) * 0.042, handleY(t) + surface * surfaceDepth, -t * handleLength), rotation: new THREE.Euler(surface === 1 ? -Math.PI / 2 : Math.PI / 2, 0, 0) });
        }
      }
    }
    r.instanced("receiver-perforations", holesGeometry, black, holes, handset);
    const digits: Placement[] = [], legends: Placement[] = [], functions: Placement[] = [];
    for (let row = 0; row < 4; row++) for (let column = 0; column < 3; column++) {
      const t = 0.64 - row * 0.063;
      const x = (column - 1) * 0.135;
      digits.push({ position: new THREE.Vector3(x, handleY(t) - 0.128, -t * handleLength), rotation: new THREE.Euler(-0.075, 0, 0) });
      legends.push({ position: new THREE.Vector3(x, handleY(t) - 0.144, -t * handleLength), rotation: new THREE.Euler(Math.PI / 2, 0, 0) });
    }
    for (let row = 0; row < 2; row++) for (let column = 0; column < 3; column++) {
      const t = 0.325 - row * 0.04;
      functions.push({ position: new THREE.Vector3((column - 1) * 0.14, handleY(t) - 0.126, -t * handleLength) });
    }
    r.instanced("twelve-receiver-number-keys", digitGeometry, black, digits, handset);
    r.instanced("receiver-key-legend-marks", legendGeometry, keyLegend, legends, handset);
    r.instanced("six-receiver-function-keys", functionGeometry, black, functions, handset);
    if (!narrow) {
      for (let line = 0; line < 14; line++) {
        const z = -1.115 + line * 0.039;
        const slot = r.box("base-speaker-slot", [0.55, 0.009, 0.013], [0.532, baseTop(z) + 0.018, z], edge, 0.003, phone);
        slot.rotation.x = 0.1;
      }
      for (const x of [0.335, 0.703]) {
        const track = r.box("long-slider-track", [0.038, 0.012, 0.54], [x, baseTop(0.575) + 0.018, 0.575], black, 0.005, phone);
        track.rotation.x = 0.1;
        r.box("slider-control", [0.135, 0.034, 0.115], [x, baseTop(x) + 0.04, x], black, 0.015, phone);
        r.box("front-function-button", [0.28, 0.031, 0.126], [x, baseTop(1.015) + 0.022, 1.015], black, 0.012, phone);
      }
      for (let led = 0; led < 3; led++) {
        const x = 0.245 + led * 0.277;
        const point = r.mesh("telephone-status-dot", new THREE.CircleGeometry(0.015, 8), black, phone);
        point.position.set(x, baseTop(0.18) + 0.016, 0.18); point.rotation.x = -Math.PI / 2 + 0.1;
      }
      const rail = r.mesh("side-metal-rail", new THREE.CylinderGeometry(0.027, 0.027, 2.42, 10), chrome, phone);
      rail.position.set(width / 2 + 0.024, 0.13, -0.015); rail.rotation.x = Math.PI / 2;
    }
    r.box("front-identification-inset", [0.37, 0.105, 0.013], [narrow ? 0.21 : 0.56, 0.217, 1.404], black, 0.005, phone);
    for (const x of [-width * 0.36, width * 0.36]) for (const z of [-1.07, 1.07]) {
      r.box("phone-rubber-foot", [0.14, 0.04, 0.13], [x, 0.014, z], black, 0.012, phone);
    }
  }
  phones[0].position.set(-1.63, 0, 0.025); phones[0].rotation.y = 0.24; phones[0].scale.setScalar(0.83);
  phones[1].position.set(0.04, 0, -1.5); phones[1].rotation.y = -0.08; phones[1].scale.setScalar(0.93);
  phones[2].position.set(0.85, 0, 1.35); phones[2].rotation.y = -0.49; phones[2].scale.setScalar(1.04);
  const baselines = handsets.map((handset) => ({ position: handset.position.clone(), rotation: handset.rotation.clone() }));
  r.group.userData.referenceCapture = "reference-round2/desktop-36.png";
  return { group: r.group, phones, handsets, baselines, dispose: r.dispose };
}
