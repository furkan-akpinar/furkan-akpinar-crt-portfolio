import * as THREE from 'three/webgpu';
import { color, cos, faceDirection, float, ivec2, mix, positionLocal, sin, texture, textureLoad, uniform, uv, vec2, vec3 } from 'three/tsl';

const TAU = Math.PI * 2;
// The approved physical spacing and entrance were authored with eleven panels.
// Content can repeat at another count without changing that geometry or timing.
const CALIBRATION_PANELS = 11;

/** Preserved foreground dimensions; the rear folds into a compact S. */
export const PROJECT_RING = {
  radiusX: 7.065,
  radiusZ: 8.716,
  sideExpansion: 0.15,
  rise: 1.449,
  depthRise: 1.808,
  sideDrop: 0.92,
  leftDepth: 0.99,
  leftDrop: 1.165,
  rearLeftDrop: 0.3,
  rearShift: 2.9,
  rearRelax: 0.25,
  rightReturnShift: 0.3,
  rearDepth: 7.4,
  rearLeftInset: 5.6,
  leftReturnDrop: 4,
  leftReturnStart: 1.505,
  rearLift: 0.47,
  rearBank: 0.35,
  panelHeight: 3.119,
  centerX: 0.031,
  centerY: -0.608,
  cameraDistance: 8,
  mobileCameraDistance: 8.4,
  mobileScale: 0.76,
  mobileCenterY: -0.5,
  perforations: 22,
} as const;

/** Positive modulo retains the fractional travel across both ends of the loop. */
export function ringPosition(position: number, count: number) {
  if (!Number.isFinite(position) || !Number.isInteger(count) || count < 1) return 0;
  return ((position % count) + count) % count;
}

export function ringProjectIndex(position: number, count: number) {
  return ringPosition(Math.round(position), count);
}

/** CPU counterpart of the closed GPU surface; reuses the caller's vector. */
function baseRingPoint(angle: number, vertical: number, target: THREE.Vector3) {
  const sine = Math.sin(angle);
  const depth = 1 - Math.cos(angle);
  const left = Math.max(0, -sine);
  const leftDepth = PROJECT_RING.leftDepth * left ** 2;
  const leftDrop = PROJECT_RING.leftDrop * left ** 5
    + PROJECT_RING.rearLeftDrop * left ** 2 * depth ** 4;
  const rearDepth = PROJECT_RING.rearDepth * THREE.MathUtils.smoothstep(depth, 1.6, 2);
  const radialScale = 1 + leftDepth / (PROJECT_RING.cameraDistance + PROJECT_RING.radiusZ * depth);
  const rightSweep = -PROJECT_RING.rearShift * THREE.MathUtils.smoothstep(depth, 0.45, 1.4)
    + PROJECT_RING.rearRelax * THREE.MathUtils.smoothstep(depth, 1.4, 2);
  const leftSweep = -0.5 * THREE.MathUtils.smoothstep(depth, 0.35, 0.65)
    - 2.15 * THREE.MathUtils.smoothstep(depth, 1.55, 1.95);
  const rearShift = THREE.MathUtils.lerp(leftSweep, rightSweep, THREE.MathUtils.smoothstep(sine, -0.15, 0.15));
  const rearInset = PROJECT_RING.rearLeftInset * left * THREE.MathUtils.smoothstep(left, 0, 0.15)
    * THREE.MathUtils.smoothstep(depth, 1.4, 1.8);
  const rightReturn = PROJECT_RING.rightReturnShift * THREE.MathUtils.smoothstep(depth, 0.35, 0.48)
    * (1 - THREE.MathUtils.smoothstep(depth, 1.1, 1.4)) * THREE.MathUtils.smoothstep(sine, 0, 0.15);
  const rearHeight = PROJECT_RING.rearLift * THREE.MathUtils.smoothstep(depth, 1.65, 2)
    - PROJECT_RING.rearBank * sine * THREE.MathUtils.smoothstep(depth, 1.3, 1.8) + rearDepth * 0.2;
  const nearY = PROJECT_RING.rise * sine + PROJECT_RING.depthRise * depth
    - PROJECT_RING.sideDrop * sine * sine - leftDrop + rearHeight;
  const levelRearY = 0.192 * (8.3 + PROJECT_RING.radiusZ * depth + leftDepth + rearDepth)
    - PROJECT_RING.panelHeight * 0.5 - PROJECT_RING.centerY;
  // The shallow left return runs behind the near strip; only the deeper HEIP/
  // Hamn part rises above it. Keep both ends C1 and leave the far rail unchanged.
  const leftReturnDrop = PROJECT_RING.leftReturnDrop * THREE.MathUtils.smoothstep(depth, PROJECT_RING.leftReturnStart, 1.8)
    * (1 - THREE.MathUtils.smoothstep(depth, 1.74, 1.84)) * THREE.MathUtils.smoothstep(left, 0, 0.2);
  const centerY = THREE.MathUtils.lerp(nearY, levelRearY, THREE.MathUtils.smoothstep(depth, 1.45, 1.85)) - leftReturnDrop;
  return target.set(
    (PROJECT_RING.radiusX * sine * (1 + PROJECT_RING.sideExpansion * sine * sine) + PROJECT_RING.centerX) * radialScale + rearShift + rightReturn + rearInset,
    vertical * PROJECT_RING.panelHeight + centerY,
    -PROJECT_RING.radiusZ * depth - leftDepth - rearDepth,
  );
}

// Bend the existing rear span instead of extending it toward the navigation.
// The endpoint never goes deeper than the previous closed loop.
const foldJoin = baseRingPoint(1.05, 0, new THREE.Vector3());
const foldControlA = new THREE.Vector3(11, 3.2, -9);
const foldControlB = new THREE.Vector3(-14, 2.2, -15);
const foldEnd = new THREE.Vector3(0.3, 5.6, -19);
const returnJoin = baseRingPoint(-1.6, 0, new THREE.Vector3());

/** CPU counterpart of the S surface and its invisible, periodic return. */
export function ringPoint(angle: number, vertical: number, target: THREE.Vector3) {
  baseRingPoint(angle, vertical, target);
  const signed = ((angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
  if (signed > 1.05) {
    const t = THREE.MathUtils.smoothstep(signed, 1.05, Math.PI);
    const u = 1 - t;
    const weight = THREE.MathUtils.smoothstep(signed, 1.05, 1.35);
    target.set(
      THREE.MathUtils.lerp(target.x, u ** 3 * foldJoin.x + 3 * u * u * t * foldControlA.x + 3 * u * t * t * foldControlB.x + t ** 3 * foldEnd.x, weight),
      THREE.MathUtils.lerp(target.y, u ** 3 * foldJoin.y + 3 * u * u * t * foldControlA.y + 3 * u * t * t * foldControlB.y + t ** 3 * foldEnd.y + vertical * PROJECT_RING.panelHeight, weight),
      THREE.MathUtils.lerp(target.z, u ** 3 * foldJoin.z + 3 * u * u * t * foldControlA.z + 3 * u * t * t * foldControlB.z + t ** 3 * foldEnd.z, weight),
    );
  } else if (signed < -1.6) {
    // Once fully invisible, return directly to the distant start instead of
    // retaining the old oval's extra dip. Keep C1 joins at both ends.
    const t = THREE.MathUtils.smoothstep(-signed, 1.6, Math.PI);
    const weight = THREE.MathUtils.smoothstep(-signed, 1.6, 2);
    target.set(THREE.MathUtils.lerp(target.x, THREE.MathUtils.lerp(returnJoin.x, foldEnd.x, t), weight),
      THREE.MathUtils.lerp(target.y, THREE.MathUtils.lerp(returnJoin.y, foldEnd.y, t) + vertical * PROJECT_RING.panelHeight, weight),
      THREE.MathUtils.lerp(target.z, THREE.MathUtils.lerp(returnJoin.z, foldEnd.z, t), weight));
  }
  return target;
}

/** Visibility depends on the path, so every project follows the same two ends. */
export function ringPathOpacity(angle: number) {
  const signed = ((angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
  const tail = THREE.MathUtils.smoothstep(signed, 1.05, Math.PI);
  return (1 - tail * 0.3) * (1 - THREE.MathUtils.smoothstep(signed, 3, Math.PI))
    * THREE.MathUtils.smoothstep(signed, -1.6, -1.2);
}

// Build once in real surface distance. Equal angles on the authored S were
// stretching the two rear images to almost twice the foreground image width.
const PATH_SAMPLES = 8192;
const LOOKUP_SAMPLES = 4096;
const pathDistances = new Float64Array(PATH_SAMPLES + 1);
const pathPoint = new THREE.Vector3();
const pathPrevious = new THREE.Vector3();
ringPoint(-Math.PI, 0, pathPrevious);
for (let sample = 1; sample <= PATH_SAMPLES; sample++) {
  ringPoint(-Math.PI + sample * TAU / PATH_SAMPLES, 0, pathPoint);
  pathDistances[sample] = pathDistances[sample - 1] + pathPrevious.distanceTo(pathPoint);
  pathPrevious.copy(pathPoint);
}

function distanceAtAngle(angle: number) {
  const sample = THREE.MathUtils.clamp((angle + Math.PI) / TAU * PATH_SAMPLES, 0, PATH_SAMPLES);
  const index = Math.min(PATH_SAMPLES - 1, Math.floor(sample));
  return THREE.MathUtils.lerp(pathDistances[index], pathDistances[index + 1], sample - index);
}

const pathZero = distanceAtAngle(0);
const pathLength = pathDistances[PATH_SAMPLES];
const filmPitch = distanceAtAngle(Math.PI / CALIBRATION_PANELS) - distanceAtAngle(-Math.PI / CALIBRATION_PANELS);
export const PROJECT_FILM = {
  pitch: filmPitch,
  calibrationPanels: CALIBRATION_PANELS,
  mediaAspect: filmPitch * 0.954 / (PROJECT_RING.panelHeight * 0.878),
  length: pathLength,
  minDistance: -pathZero,
  maxDistance: pathLength - pathZero,
  visibleStartDistance: distanceAtAngle(-1.6) - pathZero,
  // Extra physical slots let any content count repeat along the existing S.
  // Recycle only beyond both ends, never by stretching a visible panel.
  slotCount: Math.ceil(pathLength / filmPitch) + 2,
} as const;

const pathLookup = new Float32Array((LOOKUP_SAMPLES + 1) * 4);
let pathCursor = 0;
for (let sample = 0; sample <= LOOKUP_SAMPLES; sample++) {
  const distance = sample / LOOKUP_SAMPLES * pathLength;
  while (pathCursor < PATH_SAMPLES - 1 && pathDistances[pathCursor + 1] < distance) pathCursor++;
  const segment = pathDistances[pathCursor + 1] - pathDistances[pathCursor];
  const fraction = segment > 0 ? (distance - pathDistances[pathCursor]) / segment : 0;
  const angle = -Math.PI + (pathCursor + fraction) / PATH_SAMPLES * TAU;
  ringPoint(angle, 0, pathPoint);
  pathLookup.set([pathPoint.x, pathPoint.y, pathPoint.z, angle], sample * 4);
}

/** CPU and GPU share this distance-sampled path, including physical depth order. */
export function filmPoint(distance: number, vertical: number, target: THREE.Vector3) {
  const sample = THREE.MathUtils.clamp((distance + pathZero) / pathLength, 0, 1) * LOOKUP_SAMPLES;
  const index = Math.min(LOOKUP_SAMPLES - 1, Math.floor(sample));
  const fraction = sample - index;
  const offset = index * 4;
  return target.set(
    THREE.MathUtils.lerp(pathLookup[offset], pathLookup[offset + 4], fraction),
    THREE.MathUtils.lerp(pathLookup[offset + 1], pathLookup[offset + 5], fraction) + vertical * PROJECT_RING.panelHeight,
    THREE.MathUtils.lerp(pathLookup[offset + 2], pathLookup[offset + 6], fraction),
  );
}

export function filmAngleAtDistance(distance: number) {
  const sample = THREE.MathUtils.clamp((distance + pathZero) / pathLength, 0, 1) * LOOKUP_SAMPLES;
  const index = Math.min(LOOKUP_SAMPLES - 1, Math.floor(sample));
  return THREE.MathUtils.lerp(pathLookup[index * 4 + 3], pathLookup[index * 4 + 7], sample - index);
}

/**
 * Fixed-size slots follow the approved S; project ownership wraps offscreen.
 * Call update from the existing scene clock; media playback belongs to the gallery.
 * Supplied gallery/portal textures remain owned by their render-target producers.
 */
export function createProjectRing(textures: readonly THREE.Texture[], officeTexture?: THREE.Texture) {
  if (textures.length < 1) throw new Error('A project ring needs at least one project texture.');
  const count = textures.length;
  const step = TAU / CALIBRATION_PANELS;
  const initialEntryStartIndex = ringPosition(8, CALIBRATION_PANELS);
  const arcReveal = uniform(CALIBRATION_PANELS + 1);
  const portalMix = uniform(0);
  const portalScale = uniform(new THREE.Vector2(1, 1));
  const flatten = uniform(0);
  const sortPoint = new THREE.Vector3();
  const group = new THREE.Group();
  group.name = 'uniform-s-project-film';
  const shape = new THREE.PlaneGeometry(1, PROJECT_RING.panelHeight, 64, 1);
  const lookup = new THREE.DataTexture(pathLookup, LOOKUP_SAMPLES + 1, 1, THREE.RGBAFormat, THREE.FloatType);
  lookup.minFilter = lookup.magFilter = THREE.NearestFilter;
  lookup.generateMipmaps = false;
  lookup.needsUpdate = true;
  lookup.name = 'project-film-arc-length';
  const slotCount = PROJECT_FILM.slotCount;
  const centers = Array.from({ length: slotCount }, () => uniform(0));
  const revealOrders = Array.from({ length: slotCount }, () => uniform(0));
  const materials: THREE.MeshBasicNodeMaterial[] = [];
  const mediaNodes: ReturnType<typeof texture>[] = [];
  const portalWeights = Array.from({ length: slotCount }, () => uniform(0));
  const mediaIndices = [count - 1, 0, count > 1 ? 1 : 0];
  const frontSine = Math.sin(step * 0.5);
  const frontWidth = PROJECT_RING.radiusX * 2 * frontSine * (1 + PROJECT_RING.sideExpansion * frontSine * frontSine);
  const layout = {
    width: frontWidth,
    height: PROJECT_RING.panelHeight as number,
    centerY: PROJECT_RING.centerY as number,
    slope: PROJECT_RING.rise * 2 * frontSine / frontWidth,
    cameraDistance: PROJECT_RING.cameraDistance as number,
  };
  const diagnostics = { position: 0, wrappedPosition: 0, activeIndex: 0, contentCount: count, panelCount: slotCount, drawCalls: 0, visiblePanels: CALIBRATION_PANELS, entryStartIndex: initialEntryStartIndex, panelPitch: filmPitch };
  let disposed = false;
  let previousIndex = -1;

  // All panels share geometry. Only uniforms move: no rebuilt meshes or vertex uploads.
  for (let index = 0; index < slotCount; index++) {
    // Manual texel interpolation also works without float-linear filtering on
    // WebGL2/WebGPU. Both shaders use the same distance rather than raw angle.
    const samplePath = (distance: THREE.Node<'float'>) => {
      const sample = distance.add(pathZero).div(pathLength).clamp(0, 1).mul(LOOKUP_SAMPLES);
      const cell = sample.floor().min(LOOKUP_SAMPLES - 1);
      return mix(textureLoad(lookup, ivec2(cell.toInt(), 0)), textureLoad(lookup, ivec2(cell.add(1).toInt(), 0)), sample.sub(cell));
    };
    const path = samplePath(centers[index].add(positionLocal.x.mul(filmPitch)));
    const curved = path.xyz.add(vec3(0, positionLocal.y, 0));
    const flatX = positionLocal.x.mul(frontWidth);
    const flat = vec3(flatX, positionLocal.y.add(flatX.mul(layout.slope)), 0);

    const coordinates = uv();
    // Reveal stays on the calibrated physical path, independent of media repeats.
    const arcCoordinate = coordinates.x.add(revealOrders[index]);
    const arcVisible = arcCoordinate.smoothstep(arcReveal.sub(0.003), arcReveal).oneMinus();
    const edgeX = coordinates.x.sub(0.5).abs();
    const edgeY = coordinates.y.sub(0.5).abs();
    const picture = edgeX.smoothstep(0.474, 0.477).oneMinus()
      .mul(edgeY.smoothstep(0.438, 0.441).oneMinus());
    const holeX = coordinates.x.mul(PROJECT_RING.perforations).fract().sub(0.5).abs();
    const holeY = edgeY.sub(0.47).abs();
    const holes = holeX.smoothstep(0.272, 0.285).oneMinus()
      .mul(holeY.smoothstep(0.017, 0.020).oneMinus());
    const edgeBevel = edgeY.smoothstep(0.493, 0.498)
      .add(holeY.smoothstep(0.020, 0.023).oneMinus().mul(holeX.smoothstep(0.27, 0.31).oneMinus()).mul(0.3)).clamp(0, 1);
    const filmColor = mix(color('#030307'), color('#242031'), edgeBevel);
    const mediaUV = coordinates.sub(vec2(0.023, 0.061)).div(vec2(0.954, 0.878));
    // Explicit UVs otherwise bypass the gallery render target's upright UV matrix.
    const mediaTexture = texture(textures[index % count], mediaUV);
    mediaTexture.updateMatrix = true;
    mediaNodes.push(mediaTexture);
    let media = mediaTexture.rgb;
    const portalWeight = portalWeights[index];
    if (officeTexture) {
      const officeUV = coordinates.flipY().sub(0.5).mul(portalScale).add(0.5);
      media = mix(media, texture(officeTexture, officeUV).rgb, portalWeight);
    }
    const fragmentAngle = samplePath(centers[index].add(coordinates.x.sub(0.5).mul(filmPitch))).w;
    const frontFacing = cos(fragmentAngle).smoothstep(-0.1, 0.8);
    const frontLight = frontFacing.mul(0.65).add(0.35);
    // Raster face orientation follows the displaced curved surface. Angle alone
    // misclassifies the visible side returns and lets rear media bleed through.
    const nearHemisphere = float(1).sub(cos(fragmentAngle)).smoothstep(0.9, 1.2).oneMinus();
    const rearOpacity = sin(fragmentAngle).smoothstep(-0.1, 0.1).mul(0.27).add(0.08);
    const opaqueFace = faceDirection.mul(0.5).add(0.5).mul(nearHemisphere);
    const filmOpacity = mix(rearOpacity, float(1), opaqueFace);
    const fragmentSigned = fragmentAngle.add(Math.PI).mod(TAU).add(TAU).mod(TAU).sub(Math.PI);
    const pathOpacity = fragmentSigned.smoothstep(1.05, Math.PI).mul(0.3).oneMinus()
      .mul(fragmentSigned.smoothstep(3, Math.PI).oneMinus())
      .mul(fragmentSigned.smoothstep(-1.6, -1.2));
    const material = new THREE.MeshBasicNodeMaterial({
      side: THREE.DoubleSide, transparent: true, depthWrite: true,
      forceSinglePass: true, alphaTest: 0.001,
    });
    material.name = `project-film-${index}`;
    material.positionNode = mix(curved, flat, flatten.mul(portalWeight));
    material.colorNode = mix(filmColor, media.mul(mix(frontLight, float(1), portalWeight)), mix(picture, float(1), portalWeight));
    material.opacityNode = mix(holes.oneMinus().mul(arcVisible).mul(filmOpacity).mul(pathOpacity), float(1), portalWeight);
    material.toneMapped = false;
    materials.push(material);
    const panel = new THREE.Mesh(shape, material);
    panel.name = `project-film-panel-${index}`;
    panel.userData.projectIndex = index % count;
    panel.userData.logicalIndex = index;
    panel.userData.centerDistance = 0;
    panel.userData.entryArcOrder = 0;
    panel.userData.pathTexture = lookup;
    // Vertex displacement spans the whole orbit, outside the source plane's bounds.
    panel.frustumCulled = false;
    group.add(panel);
  }

  function update(position: number, exit = 0, mobile = false, visiblePanels: number = CALIBRATION_PANELS, entryStartIndex = 8, aspect = 1918 / 1078) {
    if (disposed || !Number.isFinite(position)) return;
    const wrapped = ringPosition(position, count);
    const activeIndex = ringProjectIndex(position, count);
    const startIndex = ringPosition(Math.round(Number.isFinite(entryStartIndex) ? entryStartIndex : 8), CALIBRATION_PANELS);
    const visible = Number.isFinite(visiblePanels) ? THREE.MathUtils.clamp(visiblePanels, 0, CALIBRATION_PANELS) : CALIBRATION_PANELS;
    // Put the threshold beyond the final edge when closed, preventing a seam.
    arcReveal.value = visible === CALIBRATION_PANELS ? CALIBRATION_PANELS + 1 : visible;
    const scale = mobile ? PROJECT_RING.mobileScale : 1;
    group.scale.setScalar(scale);
    group.position.y = mobile ? PROJECT_RING.mobileCenterY : PROJECT_RING.centerY;
    layout.width = frontWidth * scale;
    layout.height = PROJECT_RING.panelHeight * scale;
    layout.centerY = group.position.y;
    // Separate camera framing from the preserved film contour. The live 1918x955
    // reference fills slightly more width than the original 1918x1078 recording.
    // Bound that wide-aspect adjustment; narrower desktop and mobile fits stay intact.
    const referenceAspect = 1918 / 1078;
    const desktopPullback = Math.max(0, referenceAspect / Math.max(1, aspect) - 1) * 5.4;
    const widePushIn = Math.min(0.2, Math.max(0, aspect - referenceAspect) * 0.9);
    layout.cameraDistance = mobile ? PROJECT_RING.mobileCameraDistance : PROJECT_RING.cameraDistance + desktopPullback - widePushIn;
    const portal = THREE.MathUtils.clamp(exit * 3, 0, 1);
    portalMix.value = portal * portal * (3 - 2 * portal);
    flatten.value = THREE.MathUtils.smoothstep(exit, 0, 0.7);
    if (activeIndex !== previousIndex) {
      mediaIndices[0] = ringPosition(activeIndex - 1, count);
      mediaIndices[1] = activeIndex;
      mediaIndices[2] = ringPosition(activeIndex + 1, count);
      previousIndex = activeIndex;
    }
    let drawCalls = 0;
    const cycleCenter = (PROJECT_FILM.minDistance + PROJECT_FILM.maxDistance) / (2 * filmPitch);
    for (let index = 0; index < slotCount; index++) {
      const panel = group.children[index];
      const logicalIndex = index + slotCount * Math.round((position + cycleCenter - index) / slotCount);
      const projectIndex = ringPosition(logicalIndex, count);
      const distance = (logicalIndex - position) * filmPitch;
      centers[index].value = distance;
      // The buffer is longer than the entire path, so ownership can change only
      // after a whole panel has left the visible ribbon. Media never slides in UV.
      if (projectIndex !== panel.userData.projectIndex) mediaNodes[index].value = textures[projectIndex];
      panel.userData.projectIndex = projectIndex;
      panel.userData.logicalIndex = logicalIndex;
      panel.userData.centerDistance = distance;
      const order = ringPosition(logicalIndex - startIndex, CALIBRATION_PANELS);
      revealOrders[index].value = order;
      panel.userData.entryArcOrder = order;
      portalWeights[index].value = logicalIndex === Math.round(position) ? portalMix.value : 0;
      panel.visible = distance + filmPitch * 0.5 > PROJECT_FILM.visibleStartDistance
        && distance - filmPitch * 0.5 < PROJECT_FILM.maxDistance;
      if (panel.visible) drawCalls++;
      panel.renderOrder = filmPoint(distance, 0, sortPoint).z;
    }
    diagnostics.position = position;
    diagnostics.wrappedPosition = wrapped;
    diagnostics.activeIndex = activeIndex;
    diagnostics.visiblePanels = visible;
    diagnostics.entryStartIndex = startIndex;
    diagnostics.drawCalls = drawCalls;
  }

  update(0);
  return {
    group, layout, mediaIndices, diagnostics, portalMix, portalScale,
    get activeIndex() { return diagnostics.activeIndex; },
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      group.clear();
      shape.dispose();
      lookup.dispose();
      for (const material of materials) material.dispose();
    },
  };
}

