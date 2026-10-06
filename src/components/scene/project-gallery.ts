import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const WIDTH = 512;
const HEIGHT = 384;
const FRAME_INTERVAL = 1 / 12;
const ASSETS = {
  building: '/models/kenney-city-kit-commercial/selected/building-c.glb',
  wideBuilding: '/models/kenney-city-kit-commercial/selected/building-e.glb',
  plant: '/models/kenney-furniture-kit/selected/pottedPlant.glb',
  chair: '/models/kenney-furniture-kit/selected/loungeChair.glb',
  table: '/models/kenney-furniture-kit/selected/tableCoffee.glb',
  deskChair: '/models/kenney-furniture-kit/selected/chairDesk.glb',
} as const;

type AssetName = keyof typeof ASSETS;
type Surface = THREE.MeshStandardNodeMaterial;
type Cell = {
  scene: THREE.Scene;
  root: THREE.Group;
  camera: THREE.OrthographicCamera;
  target: THREE.RenderTarget;
  lastTime: number;
  animate?: (time: number) => void;
};

/**
 * Eleven original illustrations corresponding to the reference's project types.
 * Kenney CC0 models and local geometry only: these are not the client's artworks.
 * Call update with seconds and visible film-cell indices; await ready before use.
 */
export function createProjectGallery(renderer: THREE.WebGPURenderer) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const sourceTextures = new Set<THREE.Texture>();
  const imageBitmaps = new Set<ImageBitmap>();
  const models = new Map<AssetName, THREE.Group>();
  const abort = new AbortController();
  let disposed = false;
  let loaded = false;
  const ownGeometry = <T extends THREE.BufferGeometry>(geometry: T) => { geometries.add(geometry); return geometry; };
  const ownMaterial = <T extends THREE.Material>(material: T) => { materials.add(material); return material; };
  const boxGeometry = ownGeometry(new THREE.BoxGeometry(1, 1, 1));
  const sphereGeometry = ownGeometry(new THREE.SphereGeometry(1, 16, 12));
  const cylinderGeometry = ownGeometry(new THREE.CylinderGeometry(1, 1, 1, 40));
  const surfaces = new Map<string, Surface>();
  function surface(color: string, roughness = 0.8, metalness = 0) {
    const key = `${color}:${roughness}:${metalness}`;
    let result = surfaces.get(key);
    if (!result) {
      result = ownMaterial(new THREE.MeshStandardNodeMaterial({ color, roughness, metalness }));
      surfaces.set(key, result);
    }
    return result;
  }
  function mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, position: [number, number, number], scale: [number, number, number]) {
    const result = new THREE.Mesh(geometry, material);
    result.position.set(...position);
    result.scale.set(...scale);
    parent.add(result);
    return result;
  }
  const box = (parent: THREE.Object3D, color: string, position: [number, number, number], scale: [number, number, number]) =>
    mesh(parent, boxGeometry, surface(color), position, scale);
  const ball = (parent: THREE.Object3D, color: string, position: [number, number, number], scale: [number, number, number]) =>
    mesh(parent, sphereGeometry, surface(color), position, scale);
  const cylinder = (parent: THREE.Object3D, color: string, position: [number, number, number], scale: [number, number, number]) =>
    mesh(parent, cylinderGeometry, surface(color), position, scale);

  const backgrounds = ['#111c1b', '#deded2', '#362085', '#efd6bd', '#161d23', '#e8ece7', '#d3c5b5', '#bee0d5', '#d4dbde', '#1b454d', '#e5e0d4'];
  const cells: Cell[] = backgrounds.map((background, index) => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(background);
    const root = new THREE.Group();
    scene.add(root);
    scene.add(new THREE.HemisphereLight('#fff7e7', '#5c6b73', 1.65));
    const key = new THREE.DirectionalLight('#fff3db', 2.5);
    key.position.set(-4, 7, 5); scene.add(key);
    const fill = new THREE.DirectionalLight('#b4cbe5', 0.65);
    fill.position.set(5, 2, -3); scene.add(fill);
    const camera = new THREE.OrthographicCamera(-3.2, 3.2, 2.4, -2.4, 0.05, 50);
    camera.position.set(5, 4.5, 7);
    camera.lookAt(0, 0.7, 0);
    const target = new THREE.RenderTarget(WIDTH, HEIGHT, {
      depthBuffer: true, stencilBuffer: false, generateMipmaps: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    target.texture.name = `original-project-illustration-${index}`;
    target.texture.colorSpace = THREE.LinearSRGBColorSpace;
    // Expose conventional upright image UVs to the film's material.map consumer.
    target.texture.repeat.y = -1;
    target.texture.offset.y = 1;
    return { scene, root, camera, target, lastTime: -Infinity };
  });

  // Sets deduplicate shared GLB geometry, textures and image bitmaps during disposal.
  function trackSource(root: THREE.Object3D) {
    root.traverse((object) => {
      if (!(object as THREE.Mesh).isMesh) return;
      const item = object as THREE.Mesh;
      geometries.add(item.geometry);
      for (const material of Array.isArray(item.material) ? item.material : [item.material]) {
        materials.add(material);
        for (const value of Object.values(material)) {
          if (!value?.isTexture) continue;
          const texture = value as THREE.Texture;
          sourceTextures.add(texture);
          const image = texture.source.data;
          if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) imageBitmaps.add(image);
        }
      }
    });
  }

  function releaseOwned() {
    for (const geometry of geometries) geometry.dispose(); geometries.clear();
    for (const material of materials) material.dispose(); materials.clear();
    for (const texture of sourceTextures) texture.dispose(); sourceTextures.clear();
    for (const bitmap of imageBitmaps) bitmap.close(); imageBitmaps.clear();
  }

  function model(parent: THREE.Object3D, name: AssetName, position: [number, number, number], height: number, angle = 0) {
    const source = models.get(name)!;
    const clone = source.clone(true);
    // Each clone owns one node-material copy per source material, not per mesh.
    const copies = new Map<THREE.Material, THREE.Material>();
    clone.traverse((object) => {
      if (!(object as THREE.Mesh).isMesh) return;
      const item = object as THREE.Mesh;
      const copy = (base: THREE.Material) => {
        let result = copies.get(base);
        if (!result) {
          const standard = base as THREE.MeshStandardMaterial;
          result = ownMaterial(new THREE.MeshStandardNodeMaterial({
            color: standard.color ?? '#ffffff', map: standard.map ?? null,
            roughness: standard.roughness ?? 0.8, metalness: standard.metalness ?? 0,
            vertexColors: standard.vertexColors, side: standard.side,
            transparent: standard.transparent, opacity: standard.opacity,
            alphaTest: standard.alphaTest,
          }));
          copies.set(base, result);
        }
        return result;
      };
      item.material = Array.isArray(item.material) ? item.material.map(copy) : copy(item.material);
    });
    const bounds = new THREE.Box3().setFromObject(clone);
    const center = bounds.getCenter(new THREE.Vector3());
    clone.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));
    const pivot = new THREE.Group();
    pivot.add(clone);
    pivot.scale.setScalar(height / Math.max(bounds.max.y - bounds.min.y, 0.001));
    pivot.position.set(...position);
    pivot.rotation.y = angle;
    parent.add(pivot);
    return pivot;
  }

  function platform(parent: THREE.Object3D, color = '#b2a18a', radiusX = 2.4, radiusZ = 1.65) {
    return cylinder(parent, color, [0, 0, 0], [radiusX, 0.18, radiusZ]);
  }
  function tree(parent: THREE.Object3D, x: number, z: number, size = 0.55) {
    cylinder(parent, '#675d40', [x, size * 0.4, z], [0.045, size * 0.8, 0.045]);
    ball(parent, '#799a68', [x, size, z], [size * 0.48, size * 0.6, size * 0.48]);
  }
  function phone(parent: THREE.Object3D, x: number, y: number, angle: number, color: string) {
    const group = new THREE.Group(); group.position.set(x, y, 0); group.rotation.z = angle; parent.add(group);
    box(group, '#161921', [0, 0, 0], [1.32, 2.5, 0.17]);
    box(group, color, [0, 0, 0.095], [1.14, 2.24, 0.035]);
    box(group, '#22222d', [0, 1.02, 0.12], [0.34, 0.055, 0.02]);
    return group;
  }
  function line(parent: THREE.Object3D, points: THREE.Vector3[], color: string, radius = 0.025) {
    const curve = new THREE.CatmullRomCurve3(points);
    mesh(parent, ownGeometry(new THREE.TubeGeometry(curve, 36, radius, 6, false)), surface(color, 0.5), [0, 0, 0], [1, 1, 1]);
    return curve;
  }

  function buildIllustrations() {
    // 0 — A sage room cutaway: original interpretation of a digital showroom.
    let root = cells[0].root;
    platform(root, '#9c8d73');
    box(root, '#708d80', [0, 1.05, -1.2], [4.2, 2.1, 0.13]);
    box(root, '#889b86', [-2.05, 1.05, -0.3], [0.13, 2.1, 1.85]);
    model(root, 'chair', [0.72, 0.1, -0.2], 1.2, -0.25);
    model(root, 'table', [-0.65, 0.1, 0.6], 0.5);
    model(root, 'plant', [-1.48, 0.1, -0.7], 1.2);
    box(root, '#c2ad88', [-0.45, 0.9, -1.05], [1.2, 0.07, 0.26]);
    box(root, '#243f3f', [0.7, 1.45, -1.1], [0.7, 0.65, 0.04]);

    // 1 — An overhead furniture planner, with distinct placement and material chips.
    root = cells[1].root;
    box(root, '#acb6af', [0, 0, 0], [4.8, 0.13, 3.4]);
    for (const x of [-1.35, 0.05, 1.45]) {
      box(root, '#f4eee1', [x, 0.12, 0], [1.1, 0.07, 2.6]);
      model(root, 'table', [x, 0.17, -0.5], 0.45);
      model(root, 'deskChair', [x, 0.17, 0.65], 0.7, Math.PI);
      cylinder(root, '#b89574', [x, 0.19, -1.0], [0.14, 0.02, 0.14]);
    }
    model(root, 'plant', [-2.0, 0.1, 1.12], 0.65);
    cells[1].camera.position.set(3.3, 8, 4); cells[1].camera.lookAt(0, 0, 0);

    // 2 — Violet campaign art, two phones and original game-like screen geometry.
    root = cells[2].root;
    const leftPhone = phone(root, -0.8, 1.1, -0.18, '#abacd8');
    const rightPhone = phone(root, 0.9, 1.35, 0.16, '#67c6bb');
    for (let row = 0; row < 3; row++) for (let column = 0; column < 2; column++) {
      box(leftPhone, ['#efa982', '#698ba9', '#edcd70'][(row + column) % 3], [-0.28 + column * 0.56, 0.55 - row * 0.61, 0.14], [0.45, 0.49, 0.025]);
    }
    ball(rightPhone, '#eedea0', [0, 0.1, 0.28], [0.38, 0.38, 0.13]);
    cells[2].camera.position.set(0.7, 2.3, 7); cells[2].camera.lookAt(0, 1.2, 0);
    cells[2].animate = (time) => { leftPhone.rotation.z = -0.18 + Math.sin(time * 0.5) * 0.025; rightPhone.rotation.z = 0.16 - Math.sin(time * 0.5) * 0.025; };

    // 3 — Food packaging still life, not a borrowed food-brand website screenshot.
    root = cells[3].root;
    platform(root, '#e8ae94', 2.25, 1.7);
    const packageColors = ['#bb3735', '#f3b73e', '#f4e5ba'];
    for (let i = 0; i < 5; i++) {
      const x = (i - 2) * 0.8, y = 0.58 + (i % 2) * 0.18;
      const pack = box(root, packageColors[i % 3], [x, y, (i % 2) * 0.3], [0.68, y * 1.65, 0.55]);
      pack.rotation.z = (i - 2) * -0.035;
      box(root, '#f7edcb', [x, y + 0.07, (i % 2) * 0.3 + 0.28], [0.46, 0.32, 0.016]);
    }
    for (let i = 0; i < 5; i++) ball(root, '#cd5332', [-1.4 + i * 0.55, 0.26, 0.98], [0.23, 0.19, 0.23]);
    cells[3].camera.position.set(3.6, 2.9, 7); cells[3].camera.lookAt(0, 0.8, 0);

    // 4 — A string-instrument detail: amber wood and strings on a dark stage.
    root = cells[4].root;
    const instrument = new THREE.Group(); root.add(instrument); instrument.rotation.z = -0.18;
    ball(instrument, '#9a4c24', [0, 0.8, 0], [0.78, 0.88, 0.19]);
    ball(instrument, '#a75827', [0, 1.78, 0], [0.57, 0.62, 0.17]);
    box(instrument, '#301f1c', [0, 2.54, 0.1], [0.16, 1.62, 0.12]);
    box(instrument, '#d6b883', [0, 1.05, 0.23], [0.45, 0.07, 0.06]);
    for (let i = 0; i < 4; i++) box(instrument, '#bdb9aa', [-0.057 + i * 0.038, 1.86, 0.24], [0.006, 2.8, 0.006]);
    const bow = box(root, '#c99a62', [0.7, 1.7, 0.5], [3.1, 0.045, 0.045]); bow.rotation.z = 0.34;
    cells[4].camera.position.set(1.2, 1.8, 8); cells[4].camera.lookAt(0, 1.7, 0);

    // 5 — Glass-panel configurator with a material swatch rail.
    root = cells[5].root;
    box(root, '#8d9693', [0, 0, 0], [3.8, 0.15, 2.5]);
    box(root, '#eeebe1', [0, 1.1, -1.2], [3.8, 2.2, 0.11]);
    const glass = ownMaterial(new THREE.MeshStandardNodeMaterial({ color: '#a9cccf', transparent: true, opacity: 0.43, roughness: 0.18, metalness: 0.12, depthWrite: false, side: THREE.DoubleSide }));
    for (const x of [-0.7, 0.72]) {
      mesh(root, boxGeometry, glass, [x, 1.0, 0.23], [1.25, 1.95, 0.035]);
      box(root, '#555e5a', [x - 0.625, 1.0, 0.23], [0.025, 1.95, 0.05]);
      box(root, '#555e5a', [x, 2.0, 0.23], [1.28, 0.025, 0.05]);
    }
    model(root, 'table', [0.9, 0.1, -0.6], 0.38);
    for (let i = 0; i < 4; i++) cylinder(root, ['#b9cac4', '#d3bb94', '#495b5c', '#cda59b'][i], [-1.1 + i * 0.7, 0.12, 1.04], [0.18, 0.03, 0.18]);

    // 6 — Dreamlike landscape framed as a creative image-generation canvas.
    root = cells[6].root;
    box(root, '#ede5d9', [0, 1.3, -0.15], [4.1, 2.9, 0.12]);
    box(root, '#e7ad82', [0, 1.3, -0.07], [3.82, 2.62, 0.035]);
    ball(root, '#f7dd9c', [0.85, 2.0, 0.06], [0.48, 0.48, 0.04]);
    for (let i = 0; i < 5; i++) ball(root, ['#617d83', '#8ca191', '#aea38f'][i % 3], [-1.7 + i * 0.85, 0.37 + (i % 2) * 0.13, 0.03 + i * 0.08], [1.05, 0.72, 0.13]);
    model(root, 'chair', [0.65, -0.1, 0.8], 0.9, -0.3);
    cells[6].camera.position.set(0.5, 2.5, 8); cells[6].camera.lookAt(0, 1.2, 0);

    // 7 — Miniature street plus translucent phone viewport and an AR marker.
    root = cells[7].root;
    box(root, '#c4bfae', [0, 0, 0], [4.4, 0.12, 3.1]);
    model(root, 'building', [-1.15, 0.07, -0.4], 1.3);
    model(root, 'wideBuilding', [1.1, 0.07, -0.65], 1.0);
    box(root, '#727a78', [0, 0.075, 0.64], [4.4, 0.03, 0.68]);
    const arPhone = phone(root, 0.35, 1.35, -0.12, '#85bcb4');
    arPhone.position.z = 0.7; arPhone.scale.setScalar(0.8);
    box(arPhone, '#f9dd81', [0, -0.15, 0.2], [0.4, 0.55, 0.13]);
    tree(root, -1.9, 0.9, 0.7);
    cells[7].animate = (time) => { arPhone.position.y = 1.35 + Math.sin(time * 0.9) * 0.035; };

    // 8 — Harbor logistics: original shore, warehouses, cranes and moving packets.
    root = cells[8].root;
    box(root, '#7798a9', [0, -0.15, 0], [5.1, 0.13, 3.5]);
    box(root, '#c3bea6', [-0.8, -0.04, 0], [3.1, 0.16, 2.7]);
    model(root, 'wideBuilding', [-1.15, 0.05, -0.75], 0.6);
    for (let i = 0; i < 4; i++) {
      box(root, ['#a8533f', '#c2b067', '#7b9b98'][i % 3], [-1.9 + i * 0.5, 0.22, 0.7], [0.4, 0.28, 0.75]);
      if (i < 2) { box(root, '#d1ad5b', [0.15, 0.8, -0.7 + i * 1.2], [0.07, 1.65, 0.07]); box(root, '#d1ad5b', [0.55, 1.61, -0.7 + i * 1.2], [0.87, 0.07, 0.07]); }
    }
    const route = line(root, [new THREE.Vector3(-1.8, 0.34, 0), new THREE.Vector3(-0.5, 0.5, -0.1), new THREE.Vector3(0.9, 0.5, 0.45), new THREE.Vector3(2.2, 0.2, 1.1)], '#f2d07e', 0.025);
    const packet = ball(root, '#fff0b1', [0, 0, 0], [0.09, 0.09, 0.09]);
    cells[8].animate = (time) => { packet.position.copy(route.getPoint((time * 0.08) % 1)); };

    // 9 — Green island plan, not the reference's customer project imagery.
    root = cells[9].root;
    platform(root, '#929d70', 2.5, 1.8);
    box(root, '#c3b997', [0, 0.12, 0], [4.5, 0.03, 0.22]);
    box(root, '#c3b997', [-0.4, 0.12, 0], [0.2, 0.03, 3.1]);
    for (let i = 0; i < 6; i++) model(root, i % 2 ? 'building' : 'wideBuilding', [-1.45 + (i % 3) * 1.3, 0.1, i < 3 ? -0.65 : 0.65], 0.55 + (i % 3) * 0.12, i % 2 ? Math.PI / 2 : 0);
    for (let i = 0; i < 18; i++) {
      const a = i / 18 * Math.PI * 2;
      tree(root, Math.cos(a) * 2.14, Math.sin(a) * 1.47, 0.23 + (i % 3) * 0.04);
    }
    cells[9].camera.position.set(5, 6.2, 7); cells[9].camera.lookAt(0, 0.2, 0);

    // 10 — A single folded iridescent-like sheet, not repeated decorative rings.
    root = cells[10].root;
    const sheet = ownGeometry(new THREE.PlaneGeometry(3.3, 2.5, 48, 20));
    const positions = sheet.attributes.position;
    const colors: number[] = [];
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i);
      positions.setXYZ(i, x, y + Math.sin(x * 1.8) * 0.42, Math.sin(x * 1.8 + y * 0.8) * 0.55);
      const color = new THREE.Color().setHSL((x / 3.3 + 0.5) * 0.8 + 0.05, 0.55, 0.64);
      colors.push(color.r, color.g, color.b);
    }
    sheet.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); sheet.computeVertexNormals();
    const foil = ownMaterial(new THREE.MeshStandardNodeMaterial({ vertexColors: true, side: THREE.DoubleSide, metalness: 0.42, roughness: 0.28 }));
    const sculpture = mesh(root, sheet, foil, [0, 1.0, 0], [1, 1, 1]); sculpture.rotation.z = -0.32;
    cylinder(root, '#c5b8a6', [0, -0.55, 0], [1.7, 0.18, 1.0]);
    cells[10].camera.position.set(1.8, 2.5, 8); cells[10].camera.lookAt(0, 0.65, 0);
    cells[10].animate = (time) => { sculpture.rotation.y = Math.sin(time * 0.25) * 0.1; };
  }

  function renderCells(time: number, indices: number[], force = false) {
    if (disposed || !loaded || !Number.isFinite(time)) return;
    const previousTarget = renderer.getRenderTarget();
    const previousFace = renderer.getActiveCubeFace();
    const previousMip = renderer.getActiveMipmapLevel();
    const previousAutoClear = renderer.autoClear;
    const previousColor = renderer.autoClearColor;
    const previousDepth = renderer.autoClearDepth;
    try {
      renderer.autoClear = true; renderer.autoClearColor = true; renderer.autoClearDepth = true;
      for (const index of new Set(indices)) {
        if (!Number.isInteger(index) || index < 0 || index >= cells.length) continue;
        const cell = cells[index];
        if (!force && time >= cell.lastTime && time - cell.lastTime < FRAME_INTERVAL) continue;
        cell.animate?.(time);
        renderer.setRenderTarget(cell.target);
        renderer.render(cell.scene, cell.camera);
        cell.lastTime = time;
      }
    } finally {
      renderer.setRenderTarget(previousTarget, previousFace, previousMip);
      renderer.autoClear = previousAutoClear; renderer.autoClearColor = previousColor; renderer.autoClearDepth = previousDepth;
    }
  }

  const loader = new GLTFLoader();
  const ready: Promise<void> = (async () => {
    const results = await Promise.allSettled(Object.entries(ASSETS).map(async ([name, url]) => {
      const response = await fetch(url, { signal: abort.signal });
      if (!response.ok) throw new Error(`Project illustration asset ${url}: HTTP ${response.status}`);
      const data = await response.arrayBuffer();
      if (disposed) return;
      // parseAsync's second argument resolves the city's external colormap texture.
      const gltf = await loader.parseAsync(data, url.slice(0, url.lastIndexOf('/') + 1));
      trackSource(gltf.scene);
      if (disposed) { releaseOwned(); return; }
      models.set(name as AssetName, gltf.scene);
    }));
    if (disposed) return;
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map((result) => result.reason), 'Project gallery model loading failed');
    buildIllustrations();
    loaded = true;
    // One initial render fills every texture. Later frames only render visible cells.
    renderCells(0, cells.map((_, index) => index), true);
  })();

  return {
    textures: cells.map((cell) => cell.target.texture),
    ready,
    update(time: number, indices: number[]) { renderCells(time, indices); },
    dispose() {
      if (disposed) return;
      disposed = true; abort.abort();
      for (const cell of cells) { cell.scene.clear(); cell.target.dispose(); }
      models.clear(); surfaces.clear(); releaseOwned();
    },
  };
}
