import assert from 'node:assert/strict';
import test from 'node:test';
import { APERTURE_CHANNELS, sampleApertureChannel } from '../src/components/scene/project-aperture-motion.ts';

const aspects = [320 / 568, 390 / 844, 768 / 1024, 1, 1.1, 1.2, 1.3, 1.4, 844 / 390];
const portraitMilestones = [0, .125, .25, .40, .56, .72, .86, .94, 1];
const milestones = (aspect: number) => {
  const portraitWeight = Math.max(0, Math.min(1, (1.4 - aspect) / .4));
  return portraitMilestones.map((time, index) => index / 8 + (time - index / 8) * portraitWeight);
};
const close = (actual: number, expected: number, message: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-10, `${message}: ${actual} != ${expected}`);

test('mobile aperture retains every authored pose without channel overshoot between poses', () => {
  for (const aspect of aspects) {
    const times = milestones(aspect);
    for (const [name, values] of Object.entries(APERTURE_CHANNELS)) {
      times.forEach((time, index) => close(sampleApertureChannel(values, time, true, aspect), values[index], `${name} milestone ${index} at ${aspect}`));
      for (let index = 0; index < times.length - 1; index++) {
        const low = Math.min(values[index], values[index + 1]);
        const high = Math.max(values[index], values[index + 1]);
        for (let step = 0; step <= 100; step++) {
          const progress = times[index] + (times[index + 1] - times[index]) * step / 100;
          const value = sampleApertureChannel(values, progress, true, aspect);
          assert.ok(value >= low - 1e-10 && value <= high + 1e-10,
            `${name} overshot pose interval ${index} at aspect ${aspect}, progress ${progress}`);
        }
      }
    }
  }
});

test('mobile aperture radius never shrinks during forward finger travel at any tested aspect', () => {
  for (const aspect of aspects) {
    let previous = -Infinity;
    for (let step = 0; step <= 2000; step++) {
      const radius = sampleApertureChannel(APERTURE_CHANNELS.radius, step / 2000, true, aspect);
      assert.ok(radius >= previous, `radius reversed at aspect ${aspect}, sample ${step}`);
      previous = radius;
    }
  }
});

test('all mobile pose channels have continuous slopes across their milestones', () => {
  const epsilon = 1e-7;
  for (const aspect of aspects) {
    for (const [name, values] of Object.entries(APERTURE_CHANNELS)) {
      for (const progress of milestones(aspect).slice(1, -1)) {
        const at = sampleApertureChannel(values, progress, true, aspect);
        const left = (at - sampleApertureChannel(values, progress - epsilon, true, aspect)) / epsilon;
        const right = (sampleApertureChannel(values, progress + epsilon, true, aspect) - at) / epsilon;
        assert.ok(Math.abs(left - right) < .002,
          `${name} changes speed abruptly at aspect ${aspect}, progress ${progress}: ${left} -> ${right}`);
      }
    }
  }
});

test('holding, resuming and reversing sample exactly the same mobile poses without accumulated state', () => {
  const positions = [0, .02, .125, .21, .4, .53, .72, .81, .94, .99, 1];
  for (const aspect of aspects) {
    const pose = (progress: number) => Object.fromEntries(Object.entries(APERTURE_CHANNELS)
      .map(([name, values]) => [name, sampleApertureChannel(values, progress, true, aspect)]));
    const forward = positions.map(pose);
    for (let index = positions.length - 1; index >= 0; index--) {
      assert.deepEqual(pose(positions[index]), forward[index], 'reverse travel must retrace the same pose');
      assert.deepEqual(pose(positions[index]), forward[index], 'holding must not advance any channel');
    }
    assert.deepEqual(positions.map(pose), forward, 'a new drag must not inherit animation history');
  }
});

test('desktop retains the original uniform linear interpolation regardless of aspect', () => {
  for (const aspect of aspects) {
    for (const [name, values] of Object.entries(APERTURE_CHANNELS)) {
      for (let step = 0; step <= 128; step++) {
        const progress = step / 128;
        const index = Math.min(7, Math.floor(progress * 8));
        const expected = values[index] + (values[index + 1] - values[index]) * (progress * 8 - index);
        assert.equal(sampleApertureChannel(values, progress, false, aspect), expected, `${name} desktop changed at ${progress}`);
      }
    }
  }
  close(sampleApertureChannel(APERTURE_CHANNELS.radius, .3125), .0659, 'approved desktop opening radius');
  close(sampleApertureChannel(APERTURE_CHANNELS.radius, .6875), .601, 'approved desktop expanding radius');
});

test('portrait reveals grow more gradually through the visible middle while retaining ember and endpoint poses', () => {
  const radius = APERTURE_CHANNELS.radius;
  for (const aspect of aspects.filter(value => value <= 1)) {
    for (let step = 40; step <= 80; step++) {
      const progress = step / 100;
      assert.ok(sampleApertureChannel(radius, progress, true, aspect) < sampleApertureChannel(radius, progress),
        `portrait must retain more of the film at progress ${progress}`);
    }
    for (const progress of [0, .125, .25, 1]) {
      close(sampleApertureChannel(radius, progress, true, aspect), sampleApertureChannel(radius, progress),
        `preserved ember/endpoint pose at ${progress}`);
    }
  }
});

test('the terminal pose covers portrait and landscape corners even at the smallest silhouette lobe', () => {
  for (const aspect of [...aspects, 2.7]) {
    const sample = (values: readonly number[]) => sampleApertureChannel(values, 1, true, aspect);
    const extent = Math.max(1, aspect / (1908 / 1074));
    const cornerX = Math.max(sample(APERTURE_CHANNELS.centerX), 1 - sample(APERTURE_CHANNELS.centerX)) * aspect;
    const cornerY = Math.max(sample(APERTURE_CHANNELS.centerY), 1 - sample(APERTURE_CHANNELS.centerY));
    const furthestCorner = Math.hypot(cornerX, cornerY) / extent;
    const minimumSilhouette = 1 - .085 - .050 - .021;
    const edgeAllowance = .024 + .019 + .006 + .003;
    assert.ok(sample(APERTURE_CHANNELS.radius) * minimumSilhouette > furthestCorner + edgeAllowance,
      `the last aperture pose leaves a corner uncovered at aspect ${aspect}`);
    assert.equal(sample(APERTURE_CHANNELS.exposure), 0, 'no exposure jump when handing off to About');
    assert.equal(sample(APERTURE_CHANNELS.glow), 0, 'no halo left at the handoff');
  }
});

test('sampling clamps out-of-range progress and returns finite starting poses for invalid progress', () => {
  for (const mobile of [false, true]) {
    for (const values of Object.values(APERTURE_CHANNELS)) {
      for (const progress of [NaN, Infinity, -Infinity, -1]) assert.equal(sampleApertureChannel(values, progress, mobile), values[0]);
      assert.equal(sampleApertureChannel(values, 2, mobile), values[8]);
    }
  }
});
