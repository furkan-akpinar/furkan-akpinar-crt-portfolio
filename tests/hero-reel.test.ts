import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import {
  HERO_REEL_CLIPS,
  HERO_REEL_CLIP_SECONDS,
  HERO_REEL_DURATION,
  heroReelClipIndex,
  heroReelFrame,
  heroReelTime,
  validateHeroReelTrack,
  writeHeroReelLighting,
  type HeroReelRGB,
} from '../src/components/scene/hero-reel-sampling.ts';

test('decoded microsecond timestamps select the actual frame without a one-frame lighting delay', () => {
  for(let frame=0;frame<360;frame++)assert.equal(heroReelFrame(Math.round(frame/30*1e6)/1e6),frame);
});

test('hero reel honors the six supplied Pinterest clips and holds each for exactly two seconds', () => {
  assert.deepEqual(HERO_REEL_CLIPS, ['snowboard', 'motocross', 'laser-concert', 'ocean', 'skydiving', 'lofoten']);
  assert.equal(HERO_REEL_CLIP_SECONDS, 2);
  for (let clip = 0; clip < HERO_REEL_CLIPS.length; clip++) {
    const start = clip * 2;
    assert.equal(heroReelClipIndex(start), clip);
    assert.equal(heroReelClipIndex(start + 2 - 0.0001), clip);
    assert.equal(heroReelFrame(start), clip * 60);
    assert.equal(heroReelFrame(start + 2 - 0.0001), clip * 60 + 59);
  }
});

test('hero media time wraps naturally in either direction and survives invalid clocks', () => {
  assert.equal(heroReelFrame(HERO_REEL_DURATION), 0);
  assert.equal(heroReelFrame(-1 / 30), 359);
  assert.equal(heroReelClipIndex(HERO_REEL_DURATION - 0.00001), 5);
  assert.equal(heroReelFrame(3 * HERO_REEL_DURATION + 2), 60);
  for (const invalid of [NaN, Infinity, -Infinity]) {
    assert.equal(heroReelTime(invalid), 0);
    assert.equal(heroReelFrame(invalid), 0);
  }
});

test('the shipped lighting bake covers every encoded reel frame with bounded 4 × 3 sRGB samples', () => {
  const value: unknown = JSON.parse(readFileSync(new URL('../public/media/hero-pinterest/light-tracks.json', import.meta.url), 'utf8'));
  const track = validateHeroReelTrack(value);
  assert.equal(track.samples.length, 360);
  assert.throws(() => validateHeroReelTrack({ ...track, samples: track.samples.slice(1) }), /360 frames/);
  assert.throws(() => validateHeroReelTrack({ ...track, frameRate: 24 }), /30 fps/);
  const invalidFrame = Array.from({ length: 12 }, () => [0, 0, 0]);
  invalidFrame[0][0] = NaN;
  assert.throws(() => validateHeroReelTrack({ ...track, samples: [invalidFrame, ...track.samples.slice(1)] }), /finite sRGB/);
});

test('lighting is converted to linear space before averaging and retains reusable cells across a hard cut', () => {
  const cells = Array.from({ length: 12 }, () => new THREE.Color());
  const references = cells.slice();
  const average = new THREE.Color();
  const gray: HeroReelRGB[] = Array.from({ length: 12 }, () => [0.5, 0.5, 0.5]);
  const luminance = writeHeroReelLighting(gray, cells, average);
  assert.ok(Math.abs(luminance - 0.21404114) < 1e-6);
  const cut: HeroReelRGB[] = Array.from({ length: 12 }, (_, index) => index < 6 ? [1, 0, 0] : [0, 0, 1]);
  assert.ok(Math.abs(writeHeroReelLighting(cut, cells, average) - 0.1424) < 1e-6);
  assert.deepEqual([average.r, average.g, average.b], [0.5, 0, 0.5]);
  for (let index = 0; index < cells.length; index++) {
    assert.equal(cells[index], references[index]);
    assert.equal(cells[index].g, 0, 'a hard cut contains no residual gray from the previous clip');
  }
});
