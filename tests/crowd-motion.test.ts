import assert from 'node:assert/strict';
import test from 'node:test';
import { clapCellSize, clapOpenness, clapPoint, clapRigs } from '../src/components/scene/crowd-motion.ts';

function atPixel(index: number, x: number, y: number, phase: number) {
  const offset = clapPoint(index, x / clapCellSize.width, 1 - y / clapCellSize.height, phase);
  return { x: offset.du * clapCellSize.width, y: -offset.dv * clapCellSize.height };
}

test('each crowd pair opens opposing hands, then returns to its captured close pose', () => {
  clapRigs.forEach((rig, index) => {
    const [left, right] = rig.arms;
    const direction = [right.hand[0] - left.hand[0], right.hand[1] - left.hand[1]];
    const first = atPixel(index, ...left.hand, 0), second = atPixel(index, ...right.hand, 0);
    assert.ok(first.x * direction[0] + first.y * direction[1] < 0, `person ${index}: first hand opens away from contact`);
    assert.ok(second.x * direction[0] + second.y * direction[1] > 0, `person ${index}: second hand opens away from contact`);
    // The visual review capped still-image articulation to avoid elastic palms.
    for (const motion of [first, second]) assert.ok(Math.hypot(motion.x, motion.y) >= 7.5 && Math.hypot(motion.x, motion.y) <= 15, `person ${index}: visible, bounded hand travel`);
    for (const arm of rig.arms) {
      const closed = atPixel(index, ...arm.hand, 0.5);
      assert.ok(Math.hypot(closed.x, closed.y) < 1e-9, 'contact restores the unchanged photographic pose');
    }
    const openDistance = Math.hypot(direction[0] + second.x - first.x, direction[1] + second.y - first.y);
    assert.ok(openDistance - Math.hypot(...direction) >= 15, 'the clap changes inter-hand distance, not just billboard position');
  });
});

test('clapping anchors elbows and leaves head, torso and feet still', () => {
  clapRigs.forEach((rig, index) => {
    for (const phase of [0, 0.15, 0.5, 0.85, 1]) {
      for (const arm of rig.arms) {
        const elbow = atPixel(index, ...arm.elbow, phase);
        assert.ok(Math.hypot(elbow.x, elbow.y) < 0.25, `person ${index}: fixed elbow pivot`);
      }
      for (const y of [30, 60, 245, 300, 420, 495]) for (const x of [100, 170, 240, 300]) {
        assert.deepEqual(atPixel(index, x, y, phase), { x: 0, y: -0 }, `person ${index}: fixed body row ${y}`);
      }
    }
  });
});

test('clap sampling is cyclic and reversible without accumulated transforms', () => {
  clapRigs.forEach((rig, index) => {
    for (const arm of rig.arms) {
      assert.deepEqual(atPixel(index, ...arm.hand, 0), atPixel(index, ...arm.hand, 1));
      for (const phase of [0.1, 0.25, 0.4]) {
        const forward = atPixel(index, ...arm.hand, phase), reverse = atPixel(index, ...arm.hand, 1 - phase);
        assert.ok(Math.abs(forward.x - reverse.x) < 1e-10 && Math.abs(forward.y - reverse.y) < 1e-10);
      }
    }
  });
  assert.equal(clapOpenness(Number.NaN), 0);
  assert.deepEqual(clapPoint(8, 0.5, 0.5, 0), { du: 0, dv: 0 });
  assert.deepEqual(clapPoint(0, Number.NaN, 0.5, 0), { du: 0, dv: 0 });
});

test('the complete deformation field remains finite and bounded within the arm area', () => {
  for (let index = 0; index < clapRigs.length; index++) {
    let moved = 0;
    for (let y = 0; y <= 512; y += 8) for (let x = 0; x <= 384; x += 8) {
      const offset = atPixel(index, x, y, 0);
      const length = Math.hypot(offset.x, offset.y);
      assert.ok(Number.isFinite(length) && length <= 22, 'deformation cannot shoot a vertex outside the hand-travel envelope');
      if (length > 0.01) { moved++; assert.ok(y >= 76 && y <= 223, 'only arm-region vertices move'); }
    }
    assert.ok(moved > 30, 'the forearm has continuous support, not two isolated hand vertices');
  }
});
