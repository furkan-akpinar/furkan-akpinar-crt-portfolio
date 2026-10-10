import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { publicAssetUrl } from '../../lib/public-asset.ts';

export const COMPUTER_MODEL_URL = publicAssetUrl('/models/furkan-crt/furkan-crt-computer.glb');
const FLOOR_Y = -1.1725;
const COMPUTER_HEIGHT = 2.8;
const SCREEN_FRONT_Z = 0.52;

export type ComputerGroundLayout = {
  floorY: number;
  contacts: Array<{ x: number; z: number; width: number; depth: number }>;
};

/** Keep the authored curved glass, UVs and integrated chassis intact. */
export function arrangeCrtComputer(source: THREE.Group, screenMaterial: THREE.Material) {
  const screenMesh = source.getObjectByName('computer-curved-crt-screen') as THREE.Mesh | undefined;
  if (!screenMesh?.isMesh) throw new Error('CRT model is missing its curved display mesh.');
  source.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(source);
  const height = bounds.max.y - bounds.min.y;
  if (!(height > 0)) throw new Error('CRT model has no physical height.');
  const scale = COMPUTER_HEIGHT / height;
  const positions = screenMesh.geometry.getAttribute('position');
  const normals = screenMesh.geometry.getAttribute('normal');
  const uv = screenMesh.geometry.getAttribute('uv');
  if (!positions || !normals || !uv) throw new Error('CRT display geometry is incomplete.');

  // The tilt is baked into the vertices. A node quaternion or the maximum Z
  // bound would aim off-centre. Use the authored middle of the display instead.
  let centerIndex = 0, closest = Infinity;
  for (let index = 0; index < uv.count; index++) {
    const distance = (uv.getX(index) - .5) ** 2 + (uv.getY(index) - .5) ** 2;
    if (distance < closest) { closest = distance; centerIndex = index; }
  }
  const center = new THREE.Vector3().fromBufferAttribute(positions, centerIndex);
  const normal = new THREE.Vector3().fromBufferAttribute(normals, centerIndex);
  screenMesh.localToWorld(center);
  normal.applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(screenMesh.matrixWorld));
  source.scale.setScalar(scale);
  source.position.set(
    -(bounds.min.x + bounds.max.x) * .5 * scale,
    FLOOR_Y - bounds.min.y * scale,
    SCREEN_FRONT_Z - center.z * scale,
  );
  source.updateMatrixWorld(true);

  const screen = new THREE.Object3D();
  screen.name = 'crt-screen-camera-target';
  screen.position.copy(screenMesh.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, centerIndex)));
  screen.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.normalize());
  const inverse = screen.quaternion.clone().invert();
  const displayBounds = new THREE.Box3();
  const point = new THREE.Vector3();
  for (let index = 0; index < positions.count; index++) {
    screenMesh.localToWorld(point.fromBufferAttribute(positions, index));
    displayBounds.expandByPoint(point.sub(screen.position).applyQuaternion(inverse));
  }
  const displaySize = displayBounds.getSize(new THREE.Vector3());
  const screenSize = new THREE.Vector2(displaySize.x, displaySize.y);
  screen.userData.size = { width: screenSize.x, height: screenSize.y };
  screenMesh.material = screenMaterial;
  source.traverse(object => {
    if (!(object as THREE.Mesh).isMesh) return;
    object.castShadow = object.receiveShadow = object !== screenMesh;
  });
  const arranged = new THREE.Box3().setFromObject(source);
  const groundLayout: ComputerGroundLayout = {
    floorY: FLOOR_Y,
    contacts: [{
      x: (arranged.min.x + arranged.max.x) * .5,
      z: (arranged.min.z + arranged.max.z) * .5,
      width: arranged.max.x - arranged.min.x,
      depth: arranged.max.z - arranged.min.z,
    }],
  };
  return { source, screen, screenMesh, screenSize, groundLayout, scale };
}

/** One self-contained GLB on every device; no large texture tiers to decode. */
export function createCrtComputer(screenMaterial: THREE.Material) {
  const group = new THREE.Group();
  group.name = 'furkan-procedural-crt-computer';
  group.userData.assetStatus = 'original-procedural-model';
  const screen = new THREE.Object3D();
  screen.name = 'crt-screen-camera-target';
  group.add(screen);
  const screenSize = new THREE.Vector2(2.15, 1.62);
  const groundLayout: ComputerGroundLayout = { floorY: FLOOR_Y, contacts: [] };
  const diagnostics = {
    loaded: false, error: null as string | null, source: COMPUTER_MODEL_URL, assetVariant: 'shared',
    scale: 0, screenSize: [0, 0], screenCenter: [0, 0, 0],
    meshes: 0, triangles: 0, materials: [] as string[],
    textures: [] as { name: string; width: number; height: number; channel: number }[],
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
  loader.register(parser => {
    // parseAsync cannot be cancelled. Track partially resolved resources so a
    // page exit or decoding error also releases the outstanding GPU/bitmap data.
    const loadGeometries = parser.loadGeometries.bind(parser);
    parser.loadGeometries = async primitives => {
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
    return { name: 'FURKAN_CRT_RESOURCE_OWNERSHIP' };
  });
  const ready = (async () => {
    try {
      const response = await fetch(COMPUTER_MODEL_URL, { signal: controller.signal });
      if (!response.ok) throw new Error(`CRT model request failed: HTTP ${response.status}`);
      const binary = await response.arrayBuffer();
      if (disposed) return;
      const gltf = await loader.parseAsync(binary, '');
      if (disposed) { releaseOwned(); return; }
      const model = arrangeCrtComputer(gltf.scene, screenMaterial);
      screen.position.copy(model.screen.position);
      screen.quaternion.copy(model.screen.quaternion);
      screen.userData.size = model.screen.userData.size;
      screenSize.copy(model.screenSize);
      groundLayout.contacts.push(...model.groundLayout.contacts);
      group.add(model.source);
      group.traverse(object => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        diagnostics.meshes++;
        diagnostics.triangles += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3;
      });
      diagnostics.loaded = true;
      diagnostics.scale = model.scale;
      screenSize.toArray(diagnostics.screenSize);
      screen.position.toArray(diagnostics.screenCenter);
      diagnostics.materials = [...materials].map(material => material.name);
      diagnostics.textures = [...textures].map(texture => {
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
