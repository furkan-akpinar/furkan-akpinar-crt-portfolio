import type { PerspectiveCamera } from 'three/webgpu';

// GPU reference measurements: docs/round13/{measurements,settling-analysis}.json.
// The camera responds gently around the front face; the case retains depth.
// These are a fit for our selected Commodore, not recovered source parameters.
const X = [-0.04123, 0.01592, 0.06295, 0.000843, -0.007396, -0.007070] as const;
const Y = [-0.06830, -0.11396, 0.01071, 0.016054, -0.005908, -0.006512] as const;
const bounded = (value: number) => Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;

export function heroPointerBlend(delta: number) {
  return 1 - Math.exp(-Math.max(0, Math.min(Number.isFinite(delta) ? delta : 0, 0.1)) * 2.1);
}

/** Apply once AFTER the base camera pose, fading to identity at the monitor. */
export function applyHeroParallax(camera: PerspectiveCamera, pointerX: number, pointerY: number, amount: number) {
  const fade = Math.max(0, Math.min(1, Number.isFinite(amount) ? amount : 0));
  const x = bounded(pointerX) * fade, y = bounded(pointerY) * fade;
  camera.position.x += X[0] * x + Y[0] * y;
  camera.position.y += X[1] * x + Y[1] * y;
  camera.position.z += X[2] * x + Y[2] * y;
  camera.rotateX(X[3] * x + Y[3] * y);
  camera.rotateY(X[4] * x + Y[4] * y);
  camera.rotateZ(X[5] * x + Y[5] * y);
}
