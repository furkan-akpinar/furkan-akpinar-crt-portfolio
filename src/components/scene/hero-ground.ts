import * as THREE from 'three/webgpu';
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js';
import { color, mix, mx_fractal_noise_float, uniform, uv, vec2, vec3 } from 'three/tsl';

const FLOOR_WIDTH = 44;
const FLOOR_DEPTH = 40;
const SCREEN_RADIANCE = 20; // Previous 14: stronger emission, same PBR receiving materials.
let areaLightsInitialized = false;

/** A soft, rectangular chassis contact footprint with a longer light-side penumbra. */
function createContactTexture() {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const x = column / (size - 1) - 0.5;
      const z = row / (size - 1) - 0.5;
      const dx = Math.max(Math.abs(x) - 0.40, 0);
      const dz = Math.max(Math.abs(z) - 0.40, 0);
      const contact = Math.exp(-(dx * dx + dz * dz) / 0.0012) * 0.83;
      const penumbra = Math.exp(-(((x + 0.04) / 0.43) ** 2 + ((z - 0.03) / 0.43) ** 2) * 1.35) * 0.34;
      const offset = (row * size + column) * 4;
      data[offset + 3] = Math.round((1 - (1 - contact) * (1 - penumbra)) * 255);
    }
  }
  const result = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  result.name = 'original-terminal-soft-contact';
  result.minFilter = result.magFilter = THREE.LinearFilter;
  result.generateMipmaps = false;
  result.needsUpdate = true;
  return result;
}

/**
 * World-horizontal floor anchored to the terminal's transformed rubber feet.
 * Add group to the hero scene and call update after positioning the computer.
 * Screen tint is supplied from known media metadata, never a synchronous GPU readback.
 */
type ComputerGroundSource = {
  group: THREE.Group;
  screen: THREE.Object3D;
  screenSize: THREE.Vector2;
  groundLayout: {floorY:number;contacts:Array<{x:number;z:number;width:number;depth:number}>};
  ready: Promise<void>;
};
export function createHeroGround(model: ComputerGroundSource) {
  const computer=model.group;
  const group = new THREE.Group();
  group.name = 'terminal-floor-and-contact';
  const time = uniform(0);
  const spill = uniform(1);
  const screenColor = uniform(new THREE.Color(0, 0, 0));
  const columnColors = Array.from({ length: 4 }, () => uniform(new THREE.Color(0, 0, 0)));
  const floorGeometry = new THREE.PlaneGeometry(FLOOR_WIDTH, FLOOR_DEPTH);
  const contactGeometry = new THREE.PlaneGeometry(1, 1);
  const contactTexture = createContactTexture();
  const floorMaterial = new THREE.MeshStandardNodeMaterial({
    roughness: 0.94,
    metalness: 0.025,
    transparent: true,
    depthWrite: true,
  });
  floorMaterial.name = 'mauve-haze-floor';
  const coordinate = vec2(uv().x.sub(0.5).mul(FLOOR_WIDTH), uv().y.oneMinus().sub(0.5).mul(FLOOR_DEPTH));
  const haze = mx_fractal_noise_float(vec3(coordinate.mul(vec2(0.17, 1.32)), time.mul(0.013)), 3)
    .mul(0.5).add(0.5).clamp(0, 1);
  const poolDistance = coordinate.sub(vec2(0, 2.45)).div(vec2(2.65, 1.4));
  const pool = poolDistance.dot(poolDistance).mul(-1.25).exp()
    .mul(haze.pow(1.6).mul(0.95).add(0.22)).mul(spill);
  const nearMist = coordinate.sub(vec2(-2.4, 0.9)).div(vec2(7.5, 4.2)).length().smoothstep(0, 1.8).oneMinus();
  const floorColor = mix(color('#111116'), color('#7a6574'), haze.pow(2).mul(nearMist).mul(0.67));
  // Fixed mauve ambience stays independent of the frame. Only the near, rough
  // bounce changes color; this is a soft radiance approximation, not a mirror.
  floorMaterial.colorNode = floorColor;
  // Preserve the broad bounce and add a soft spatial response: a bright patch
  // on one side of the display illuminates that side of the nearby floor.
  // The rough ground scatters light; it does not become a sharp mirror.
  let localBounce = columnColors[0].mul(0);
  for (let column = 0; column < columnColors.length; column++) {
    const distance = coordinate.sub(vec2((column - 1.5) * 0.72, 2.1)).div(vec2(0.95, 1.25));
    const falloff = distance.dot(distance).mul(-1.8).exp().mul(spill);
    localBounce = localBounce.add(columnColors[column].mul(falloff).mul(0.3));
  }
  floorMaterial.emissiveNode = screenColor.mul(pool).mul(1.85).add(localBounce)
    .add(color('#a578b1').mul(nearMist).mul(haze.pow(2)).mul(0.075));
  floorMaterial.opacityNode = coordinate.div(vec2(18, 15)).length().smoothstep(0.45, 1).oneMinus();
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.name = 'terminal-ground-receives-shadows';
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const contactMaterial = new THREE.MeshBasicNodeMaterial({
    map: contactTexture,
    transparent: true,
    opacity: 0.96,
    depthWrite: false,
  });
  // Independent footprints keep the real gap between monitor and keyboard clear.
  void model.ready.then(()=>{
    if(disposed)return;
    for(const footprint of model.groundLayout.contacts){
      const contact = new THREE.Mesh(contactGeometry, contactMaterial);
      contact.name = 'component-contact-and-soft-penumbra';
      contact.rotation.x = -Math.PI / 2;
      contact.position.set(footprint.x,0.007,footprint.z-0.8);
      contact.scale.set(footprint.width/0.8,footprint.depth/0.8,1);
      contact.renderOrder = 1;
      group.add(contact);
    }
  }).catch(()=>{/* The owning pipeline reports model load failure. */});

  if (!areaLightsInitialized) {
    THREE.RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init());
    areaLightsInitialized = true;
  }
  // Four emitting screen columns retain left/right changes and PBR response.
  // Local -Z is the emission direction; the computer screen faces local +Z.
  const screenLights = Array.from({ length: 4 }, (_, column) => {
    const light = new THREE.RectAreaLight(0xffffff, SCREEN_RADIANCE, 1.95 / 4, 1.42);
    light.name = `screen-radiance-column-${column}`;
    light.rotation.y = Math.PI;
    model.screen.add(light);
    return light;
  });

  const support = new THREE.Vector3();
  const center = new THREE.Vector3();
  const emitterScale = new THREE.Vector3();
  const diagnostics = { floorY: 0, lowestFootY: 0, highestFootY: 0, contactGap: 0.004,
    lightColors: Array.from({length:4},()=>[0,0,0]), lightIntensity: 0, floorBounce: 1.85, localBounce: 0.3 };
  let disposed = false;

  function update(seconds: number, intensity = 1, tint?: THREE.Color, cells?: readonly THREE.Color[]) {
    if (disposed) return;
    if (Number.isFinite(seconds)) time.value = seconds;
    spill.value = THREE.MathUtils.clamp(Number.isFinite(intensity) ? intensity : 1, 0, 2);
    if (tint) screenColor.value.copy(tint);
    computer.updateWorldMatrix(true, false);
    const transform = computer.matrixWorld;
    let minimum = Infinity;
    let maximum = -Infinity;
    for(const footprint of model.groundLayout.contacts){
      for (let corner = 0; corner < 4; corner++) {
        support.set(footprint.x+(corner&1?1:-1)*footprint.width/2,model.groundLayout.floorY,
          footprint.z+(corner&2?1:-1)*footprint.depth/2).applyMatrix4(transform);
        minimum = Math.min(minimum, support.y);
        maximum = Math.max(maximum, support.y);
      }
    }
    center.set(0, model.groundLayout.floorY, 0.8).applyMatrix4(transform);
    if(!Number.isFinite(minimum))minimum=maximum=center.y;
    const elements = transform.elements;
    const scaleX = Math.hypot(elements[0], elements[1], elements[2]);
    const scaleZ = Math.hypot(elements[8], elements[9], elements[10]);
    const yaw = Math.atan2(elements[8], elements[10]);
    group.position.set(center.x, minimum - diagnostics.contactGap, center.z);
    group.rotation.set(0, yaw, 0);
    group.scale.set(scaleX, 1, scaleZ);
    model.screen.getWorldScale(emitterScale);
    for (let column = 0; column < screenLights.length; column++) {
      const light = screenLights[column];
      // RectAreaLightNode uses explicit dimensions, not its parent's scale.
      light.position.set((column-1.5)*model.screenSize.x/4,0,0.02);
      light.width = model.screenSize.x / 4 * emitterScale.x;
      light.height = model.screenSize.y * emitterScale.y;
      if (cells?.length === 12) {
        const top=cells[column], middle=cells[column+4], bottom=cells[column+8];
        light.color.setRGB(top.r*.25+middle.r*.35+bottom.r*.4,
          top.g*.25+middle.g*.35+bottom.g*.4,top.b*.25+middle.b*.35+bottom.b*.4);
      } else light.color.copy(screenColor.value);
      columnColors[column].value.copy(light.color);
      light.intensity = SCREEN_RADIANCE * spill.value;
      light.color.toArray(diagnostics.lightColors[column]);
    }
    diagnostics.lightIntensity = SCREEN_RADIANCE * spill.value;
    diagnostics.floorY = group.position.y;
    diagnostics.lowestFootY = minimum;
    diagnostics.highestFootY = maximum;
  }

  update(0);
  return {
    group, floor, screenLights, diagnostics, update,
    dispose() {
      if (disposed) return;
      disposed = true;
      group.clear();
      floorGeometry.dispose();
      contactGeometry.dispose();
      floorMaterial.dispose();
      contactMaterial.dispose();
      contactTexture.dispose();
      for (const light of screenLights) { model.screen.remove(light); light.dispose(); }
    },
  };
}
