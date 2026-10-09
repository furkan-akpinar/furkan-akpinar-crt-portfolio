import * as THREE from 'three/webgpu';
import { Fn, If, float, mix, renderOutput, sRGBTransferEOTF, sin, texture, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';

/**
 * The approved soft signal prototype, applied to the final scene composite.
 * The input is a linear render target. Render this material with NoToneMapping:
 * the scene is tone-mapped here before mixing in the display-referred CRT bars.
 */
export function createMenuSignalEffect(
  sourceTexture: THREE.Texture,
  width: number,
  height: number,
  sourceToneMapping: THREE.ToneMapping = THREE.ACESFilmicToneMapping,
) {
  const progress = uniform(0);
  const motion = uniform(1);
  const size = uniform(new THREE.Vector2(Math.max(1, width), Math.max(1, height)));
  const labelVisible = uniform(0);
  const material = new THREE.MeshBasicNodeMaterial({ depthWrite: false, depthTest: false, fog: false });
  material.name = 'Menu: soft signal loss';
  material.toneMapped = false;

  // Keep a valid resource bound while the supplied lettering is loading.
  // No generic replacement font is substituted if the bitmap cannot load.
  const placeholder = new THREE.DataTexture(new Uint8Array([48, 49, 46, 255]), 1, 1);
  placeholder.needsUpdate = true;
  let loadedLabel: THREE.Texture | null = null;
  let disposed = false;

  const p = progress.clamp(0, 1);
  const envelope = p.smoothstep(0.015, 0.36).mul(p.smoothstep(0.64, 0.99).oneMinus());
  const clock = p.mul(10);
  // QuadMesh uses top-origin UVs; the approved WebGL prototype uses bottom-origin.
  const signalUV = uv().flipY();
  const center = signalUV.sub(0.5);
  const q = signalUV.add(center.mul(center.dot(center)).mul(0.075));
  const wobble = sin(q.y.mul(27).add(clock.mul(1.2))).mul(0.011)
    .add(sin(q.y.mul(65).sub(clock.mul(2))).mul(0.006))
    .add(sin(q.y.mul(132).add(clock.mul(0.7))).mul(0.002)).mul(0.24).mul(motion);

  const sceneUV = uv().add(vec2(wobble.mul(0.35).mul(envelope), 0));
  const fringe = vec2(1.3, -0.22).div(size).mul(envelope).mul(motion);
  const readScene = (at: typeof sceneUV) => renderOutput(texture(sourceTexture, at), sourceToneMapping, THREE.SRGBColorSpace).rgb;
  const scene = vec3(readScene(sceneUV.add(fringe)).r, readScene(sceneUV).g, readScene(sceneUV.sub(fringe)).b);

  const bars = Fn(([point]: [typeof q]) => {
    const n = point.x.clamp(0, 0.99999).mul(7).floor();
    const band = vec3(0.37, 0.45, 0.58).toVar();
    If(n.lessThan(1), () => { band.assign(vec3(0.70, 0.68, 0.62)); })
      .ElseIf(n.lessThan(2), () => { band.assign(vec3(0.64, 0.58, 0.36)); })
      .ElseIf(n.lessThan(3), () => { band.assign(vec3(0.38, 0.57, 0.56)); })
      .ElseIf(n.lessThan(4), () => { band.assign(vec3(0.45, 0.56, 0.38)); })
      .ElseIf(n.lessThan(5), () => { band.assign(vec3(0.59, 0.43, 0.55)); })
      .ElseIf(n.lessThan(6), () => { band.assign(vec3(0.65, 0.43, 0.39)); });
    If(point.y.lessThan(0.065), () => {
      band.assign(vec3(point.x.clamp(0, 0.9999).mul(8).floor().mul(0.048).add(0.16)));
    }).ElseIf(point.y.lessThan(0.13), () => {
      band.assign(point.x.mul(6).floor().mod(2).lessThan(1).select(vec3(0.10), vec3(0.54)));
    }).ElseIf(point.y.lessThan(0.18), () => {
      band.assign(n.mod(2).lessThan(1).select(band, vec3(0.09)));
    });
    return band;
  });
  const broadcast = q.add(vec2(wobble, 0));
  const shift = vec2(float(1).div(size.x), 0);
  const colorBars = vec3(bars(broadcast.add(shift)).r, bars(broadcast).g, bars(broadcast.sub(shift)).b);
  const hash = (point: typeof q) => sin(point.dot(vec2(127.1, 311.7))).mul(43758.5453).fract();
  const tick = clock.mul(3).floor().mul(motion);
  const raster = q.mul(size).div(vec2(1.35, 1)).floor();
  const snow = hash(raster.add(vec2(tick.mul(19), tick.mul(7)))).sub(0.5);
  const row = q.y.mul(size.y).mul(0.62).floor();
  const streak = hash(vec2(q.x.mul(size.x).div(19).floor(), row).add(tick)).sub(0.5);
  const scan = sin(q.y.mul(size.y).mul(Math.PI)).mul(0.012);
  const sweep = q.y.sub(float(1.12).sub(p.mul(1.4)).fract()).div(0.055).pow(2).negate().exp();
  const interference = colorBars.add(vec3(snow.mul(0.095).add(streak.mul(0.055)).add(scan)))
    .mul(sweep.mul(0.10).mul(motion).oneMinus());

  const aspect = size.x.div(size.y);
  const labelWidth = aspect.lessThan(1).select(float(0.80), float(0.46));
  const labelHeight = labelWidth.mul(aspect).div(5.39);
  const labelUV = q.sub(0.5).add(vec2(wobble.mul(0.18), 0)).div(vec2(labelWidth, labelHeight)).add(0.5);
  const labelMask = labelUV.x.greaterThanEqual(0).and(labelUV.x.lessThanEqual(1))
    .and(labelUV.y.greaterThanEqual(0)).and(labelUV.y.lessThanEqual(1)).select(float(1), float(0));
  const labelSample = labelUV.clamp(0, 1).mul(vec2(0.98, 0.955)).add(vec2(0.014, 0.025));
  const label = texture(placeholder, labelSample);
  const labelInk = label.rgb.dot(vec3(0.2126, 0.7152, 0.0722));
  const labelTone = mix(vec3(0.188, 0.192, 0.18), vec3(0.882, 0.87, 0.827), labelInk.smoothstep(0.20, 0.92));
  const withLabel = mix(interference, labelTone, labelMask.mul(envelope.smoothstep(0.55, 0.95)).mul(labelVisible));
  const shade = center.dot(center).mul(0.43).oneMinus();
  const corner = q.sub(0.5).abs().sub(vec2(0.477, 0.473));
  const distance = corner.max(0).length().add(corner.x.max(corner.y).min(0)).sub(0.018);
  const glass = distance.smoothstep(-0.003, 0.003).oneMinus();
  const signal = withLabel.mul(shade).clamp(0, 1).mul(glass);
  // Three performs the final linear→display transfer; avoid applying ACES to
  // the muted bar palette a second time in the renderer's output pass.
  const linearOutput = sRGBTransferEOTF(mix(scene, signal, envelope)) as THREE.Node<'vec3'>;
  material.fragmentNode = vec4(linearOutput, 1);

  const ready = new Promise<{ labelLoaded: boolean }>(resolve => {
    new THREE.TextureLoader().load('/textures/no-signal-label.webp', loaded => {
      if (disposed) {
        loaded.dispose();
        resolve({ labelLoaded: false });
        return;
      }
      loaded.colorSpace = THREE.NoColorSpace;
      loaded.minFilter = THREE.LinearFilter;
      loaded.magFilter = THREE.LinearFilter;
      loaded.generateMipmaps = false;
      loaded.needsUpdate = true;
      loadedLabel = loaded;
      label.value = loaded;
      labelVisible.value = 1;
      resolve({ labelLoaded: true });
    }, undefined, error => {
      if (!disposed) console.warn('Menu transition lettering could not load; using the signal bars without a label.', error);
      resolve({ labelLoaded: false });
    });
  });

  return {
    material, progress, motion, ready,
    resize(nextWidth: number, nextHeight: number, dpr = 1) {
      // Match the approved prototype's raster density cap independently of
      // the application's scene-target render resolution.
      const density = Math.max(1, Math.min(dpr, 1.5));
      size.value.set(Math.max(1, nextWidth * density), Math.max(1, nextHeight * density));
    },
    dispose() {
      disposed = true;
      placeholder.dispose();
      loadedLabel?.dispose();
      material.dispose();
    },
  };
}
