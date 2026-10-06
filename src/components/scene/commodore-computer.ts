import * as THREE from 'three/webgpu';
import { GLTFLoader, type GLTFParser } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_URL = '/models/commodore64/web/commodore-64-4k.gltf';
const FLOOR_Y = -1.1725;
const MONITOR_HEIGHT = 2.8;
const SCREEN_FRONT_Z = 0.52;
const KEYBOARD_GAP = 0.055;

export type ComputerGroundLayout = {
  floorY: number;
  contacts: Array<{ x: number; z: number; width: number; depth: number }>;
};

/** GLTF may clone an ORM view twice for the same non-default UV channel. */
export function shareEquivalentCommodoreOrmView(material: THREE.Material) {
  const standard = material as THREE.MeshStandardMaterial;
  const roughness = standard.roughnessMap;
  const metalness = standard.metalnessMap;
  if (!roughness || !metalness || roughness === metalness || roughness.source !== metalness.source) return false;
  const properties = ['channel', 'mapping', 'wrapS', 'wrapT', 'minFilter', 'magFilter', 'anisotropy',
    'colorSpace', 'flipY', 'format', 'type', 'internalFormat', 'premultiplyAlpha', 'unpackAlignment',
    'generateMipmaps', 'matrixAutoUpdate', 'rotation'] as const;
  if (properties.some((property) => roughness[property] !== metalness[property])) return false;
  if (Reflect.get(roughness, 'compareFunction') !== Reflect.get(metalness, 'compareFunction')) return false;
  if (!roughness.matrix.equals(metalness.matrix) || !roughness.offset.equals(metalness.offset)
    || !roughness.repeat.equals(metalness.repeat) || !roughness.center.equals(metalness.center)
    || roughness.mipmaps.length !== metalness.mipmaps.length
    || roughness.mipmaps.some((mipmap, index) => mipmap !== metalness.mipmaps[index])) return false;
  standard.metalnessMap = roughness;
  // The unused original view stays in the loader's owned texture set and is
  // disposed normally. It never needs a separate 4K GPU upload.
  return true;
}

/**
 * This changes only which authored objects are decoded. The original 4K GLB
 * stays intact on disk. Unused peripherals and the old CRT picture do not
 * consume image/GPU memory; all selected casing/keyboard PBR maps retain 4K.
 */
function selectComputerNodes(parser: GLTFParser) {
  const json = parser.json;
  const keyboard = json.nodes.findIndex((node: { name?: string }) => node.name === 'commodore 64_0');
  const monitor = json.nodes.findIndex((node: { name?: string }) => node.name === 'video monitor 1702_6');
  const screen = json.nodes.findIndex((node: { name?: string }) => node.name === 'Object_19');
  if (keyboard < 0 || monitor < 0 || screen < 0) throw new Error('Commodore model is missing its registered computer/monitor/screen nodes.');
  json.scenes = [{ name: 'Commodore hero selection', nodes: [keyboard, monitor] }];
  json.scene = 0;
  for (const [index, role] of [[keyboard, 'keyboard'], [monitor, 'monitor'], [screen, 'screen']] as const) {
    json.nodes[index].extras = { ...json.nodes[index].extras, heroRole: role };
  }
  // The curved glass geometry remains. Its baked blue desktop is superseded
  // by the supplied showreel/FBO material, so its two maps need not be decoded.
  for (const primitive of json.meshes[json.nodes[screen].mesh].primitives) delete primitive.material;
}

function roleObject(source: THREE.Object3D, role: string) {
  let result: THREE.Object3D | undefined;
  source.traverse((object) => { if (object.userData.heroRole === role) result = object; });
  if (!result) throw new Error(`Commodore ${role} object was not decoded.`);
  return result;
}

/** Projective XY mapping preserves the supplied curved CRT mesh and its aspect. */
export function mapCommodoreScreen(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!;
  const size = bounds.getSize(new THREE.Vector3());
  if (size.x <= 0 || size.y <= 0) throw new Error('Commodore screen has no display area.');
  const positions = geometry.getAttribute('position');
  const coordinates = new Float32Array(positions.count * 2);
  for (let vertex = 0; vertex < positions.count; vertex++) {
    coordinates[vertex * 2] = (positions.getX(vertex) - bounds.min.x) / size.x;
    coordinates[vertex * 2 + 1] = (positions.getY(vertex) - bounds.min.y) / size.y;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(coordinates, 2));
  return bounds;
}

/**
 * Lay out the two genuine parts with one uniform scale. Their authored shape,
 * proportions, curved glass, UV channels and material maps remain intact.
 * Exported for geometry-level validation using the downloaded binary.
 */
export function arrangeCommodoreComputer(source: THREE.Group, screenMaterial: THREE.Material) {
  const keyboard = roleObject(source, 'keyboard');
  const monitor = roleObject(source, 'monitor');
  const screenMesh = roleObject(source, 'screen') as THREE.Mesh;
  if (!screenMesh.isMesh) throw new Error('Commodore screen node is not a mesh.');
  for (const part of [keyboard, monitor]) {
    part.position.set(0, 0, 0);
    part.quaternion.identity();
    part.scale.setScalar(1);
  }
  source.updateMatrixWorld(true);
  const monitorBounds = new THREE.Box3().setFromObject(monitor);
  const keyboardBounds = new THREE.Box3().setFromObject(keyboard);
  const scale = MONITOR_HEIGHT / (monitorBounds.max.y - monitorBounds.min.y);
  const screenBounds = mapCommodoreScreen(screenMesh.geometry);
  const displayCenter = screenBounds.getCenter(new THREE.Vector3());
  // The source has a vertex exactly on its central bulge. The camera endpoint
  // is on this visible front surface, not halfway through the curved glass.
  displayCenter.z = screenBounds.max.z;
  screenMesh.localToWorld(displayCenter);

  monitor.scale.setScalar(scale);
  monitor.position.set(
    -(monitorBounds.min.x + monitorBounds.max.x) * 0.5 * scale,
    FLOOR_Y - monitorBounds.min.y * scale,
    SCREEN_FRONT_Z - displayCenter.z * scale,
  );
  keyboard.scale.setScalar(scale);
  keyboard.position.set(
    -(keyboardBounds.min.x + keyboardBounds.max.x) * 0.5 * scale,
    FLOOR_Y - keyboardBounds.min.y * scale,
    monitor.position.z + monitorBounds.max.z * scale + KEYBOARD_GAP - keyboardBounds.min.z * scale,
  );
  source.updateMatrixWorld(true);
  const screen = new THREE.Object3D();
  screen.name = 'commodore-monitor-screen-camera-target';
  const center = screenBounds.getCenter(new THREE.Vector3());
  center.z = screenBounds.max.z;
  screen.position.copy(screenMesh.localToWorld(center));
  screenMesh.getWorldQuaternion(screen.quaternion);
  const sourceScreenSize = screenBounds.getSize(new THREE.Vector3());
  const worldScale = screenMesh.getWorldScale(new THREE.Vector3());
  const screenSize = new THREE.Vector2(sourceScreenSize.x * worldScale.x, sourceScreenSize.y * worldScale.y);
  screen.userData.size = { width: screenSize.x, height: screenSize.y };
  screenMesh.material = screenMaterial;
  screenMesh.castShadow = false;
  screenMesh.receiveShadow = false;
  const groundLayout: ComputerGroundLayout = { floorY: FLOOR_Y, contacts: [] };
  for (const part of [monitor, keyboard]) {
    const bounds = new THREE.Box3().setFromObject(part);
    groundLayout.contacts.push({
      x: (bounds.min.x + bounds.max.x) * 0.5,
      z: (bounds.min.z + bounds.max.z) * 0.5,
      width: bounds.max.x - bounds.min.x,
      depth: bounds.max.z - bounds.min.z,
    });
    part.traverse((object) => {
      if (!(object as THREE.Mesh).isMesh || object === screenMesh) return;
      object.castShadow = object.receiveShadow = true;
    });
  }
  return { keyboard, monitor, screen, screenMesh, screenSize, groundLayout, scale };
}

export function createCommodoreComputer(screenMaterial: THREE.Material) {
  const group = new THREE.Group();
  group.name = 'commodore-64-and-1702-licensed-model';
  group.userData.assetStatus = 'licensed-sketchfab-commodore64';
  const screen = new THREE.Object3D();
  screen.name = 'commodore-monitor-screen-camera-target';
  group.add(screen);
  const screenSize = new THREE.Vector2(1.95, 1.42);
  const groundLayout: ComputerGroundLayout = { floorY: FLOOR_Y, contacts: [] };
  const diagnostics = {
    loaded: false, error: null as string | null, source: MODEL_URL,
    scale: 0, screenSize: [0, 0], screenCenter: [0, 0, 0],
    meshes: 0, triangles: 0, sharedOrmViews: 0, materials: [] as string[],
    textures: [] as { name: string; width: number; height: number; channel: number }[],
    selectedParts: ['commodore 64', 'video monitor 1702'],
  };
  const controller = new AbortController();
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const released = new WeakSet<object>();
  let disposed = false;

  function release(resource: { dispose(): void }) {
    if (released.has(resource)) return;
    released.add(resource);
    resource.dispose();
  }
  function releaseTexture(texture: THREE.Texture) {
    release(texture);
    const images: unknown[] = Array.isArray(texture.image) ? texture.image : [texture.image];
    for (const image of images) {
      if (image && typeof image === 'object' && 'close' in image && typeof image.close === 'function' && !released.has(image)) {
        released.add(image);
        image.close();
      }
    }
  }
  function ownGeometry(geometry: THREE.BufferGeometry) {
    geometries.add(geometry);
    if (disposed) release(geometry);
  }
  function ownTexture(texture: THREE.Texture) {
    textures.add(texture);
    if (disposed) releaseTexture(texture);
  }
  function ownMaterial(material: THREE.Material) {
    if (material === screenMaterial) return;
    materials.add(material);
    for (const value of Object.values(material)) if (value?.isTexture) ownTexture(value);
    if (disposed) release(material);
  }
  function releaseOwned() {
    for (const geometry of geometries) release(geometry);
    for (const material of materials) release(material);
    for (const texture of textures) releaseTexture(texture);
  }

  const loader = new GLTFLoader();
  loader.register((parser) => {
    // Track dependencies as they resolve, including partially decoded assets
    // after a failure or disposal. parseAsync itself has no cancellation API.
    const loadGeometries = parser.loadGeometries.bind(parser);
    parser.loadGeometries = async (primitives) => {
      const result = await loadGeometries(primitives);
      result.forEach(ownGeometry);
      return result;
    };
    const getDependency = parser.getDependency.bind(parser);
    parser.getDependency = async (type, index) => {
      const result = await getDependency(type, index);
      if (type === 'texture' && result) ownTexture(result);
      if (type === 'material' && result) ownMaterial(result);
      if ((type === 'mesh' || type === 'node') && result?.traverse) result.traverse((object: THREE.Object3D) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        ownGeometry(mesh.geometry);
        (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(ownMaterial);
      });
      return result;
    };
    return { name: 'HERO_COMMODore_SELECTION', beforeRoot() { selectComputerNodes(parser); return null; } };
  });
  const ready = (async () => {
    try {
      const response = await fetch(MODEL_URL, { signal: controller.signal });
      if (!response.ok) throw new Error(`Commodore model request failed: HTTP ${response.status}`);
      const binary = await response.arrayBuffer();
      if (disposed) return;
      const gltf = await loader.parseAsync(binary, MODEL_URL.slice(0, MODEL_URL.lastIndexOf('/') + 1));
      if (disposed) { releaseOwned(); return; }
      for (const material of materials) if (shareEquivalentCommodoreOrmView(material)) diagnostics.sharedOrmViews++;
      const model = arrangeCommodoreComputer(gltf.scene, screenMaterial);
      screen.position.copy(model.screen.position);
      screen.quaternion.copy(model.screen.quaternion);
      screen.userData.size = model.screen.userData.size;
      screenSize.copy(model.screenSize);
      groundLayout.contacts.push(...model.groundLayout.contacts);
      group.add(model.keyboard, model.monitor);
      // Native GLTF PBR materials are retained: WebGPURenderer converts them
      // to node materials, preserving normal/metalness/roughness UV channels.
      group.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        diagnostics.meshes++;
        diagnostics.triangles += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3;
      });
      diagnostics.loaded = true;
      diagnostics.scale = model.scale;
      screenSize.toArray(diagnostics.screenSize);
      screen.position.toArray(diagnostics.screenCenter);
      diagnostics.materials = [...materials].map((material) => material.name);
      diagnostics.textures = [...textures].map((texture) => {
        const image = texture.image as { width?: number; height?: number } | undefined;
        return { name: texture.name, width: image?.width ?? 0, height: image?.height ?? 0, channel: texture.channel };
      });
    } catch (error) {
      if (disposed) { releaseOwned(); return; }
      diagnostics.error = error instanceof Error ? error.message : String(error);
      disposed = true;
      controller.abort();
      releaseOwned();
      throw error;
    }
  })();
  return {
    group, screen, screenSize, groundLayout, ready, diagnostics,
    dispose() {
      disposed = true;
      controller.abort();
      releaseOwned();
      group.clear();
    },
  };
}
