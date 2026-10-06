import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera } from 'three/webgpu';
import { applyHeroParallax, heroPointerBlend } from '../src/components/scene/hero-parallax.ts';

test('camera damping is frame-rate independent and settles without overshoot', () => {
  const simulate = (fps: number) => { let value = 0; for (let i = 0; i < fps; i++) value += (1 - value) * heroPointerBlend(1 / fps); return value; };
  assert.ok(Math.abs(simulate(30) - simulate(144)) < 1e-12);
  assert.ok(simulate(60) > 0.87 && simulate(60) < 0.89);
  for (const dt of [-1, NaN, Infinity]) assert.equal(heroPointerBlend(dt), 0);
  assert.ok(heroPointerBlend(10) < 1);
});

test('monitor handoff and reduced motion remove the entire camera offset', () => {
  const camera = new PerspectiveCamera();camera.position.set(3, 2, 8);camera.lookAt(1, 0, 0);
  const position = camera.position.clone(), orientation = camera.quaternion.clone();
  applyHeroParallax(camera, 1, -1, 0);
  assert.deepEqual(camera.position.toArray(), position.toArray());assert.deepEqual(camera.quaternion.toArray(), orientation.toArray());
});

test('camera response is bounded and keeps both translation and perspective finite', () => {
  const bounded = new PerspectiveCamera(), overscroll = new PerspectiveCamera();
  applyHeroParallax(bounded, 1, -1, 1);applyHeroParallax(overscroll, 500, -500, 4);
  assert.deepEqual(bounded.position.toArray(), overscroll.position.toArray());assert.deepEqual(bounded.quaternion.toArray(), overscroll.quaternion.toArray());
  assert.ok(bounded.position.length() < 0.2);
  assert.ok(bounded.quaternion.angleTo(new PerspectiveCamera().quaternion) < 0.04);
  applyHeroParallax(overscroll, NaN, Infinity, NaN);
  assert.ok([...overscroll.position.toArray(), ...overscroll.quaternion.toArray()].every(Number.isFinite));
});
