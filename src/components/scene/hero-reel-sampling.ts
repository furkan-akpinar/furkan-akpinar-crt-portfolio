import * as THREE from 'three/webgpu';

export const HERO_REEL_CLIPS = ['snowboard', 'motocross', 'laser-concert', 'ocean', 'skydiving', 'lofoten'] as const;
export const HERO_REEL_FRAME_RATE = 30;
export const HERO_REEL_CLIP_SECONDS = 2;
export const HERO_REEL_FRAMES_PER_CLIP = HERO_REEL_FRAME_RATE * HERO_REEL_CLIP_SECONDS;
export const HERO_REEL_FRAME_COUNT = HERO_REEL_FRAMES_PER_CLIP * HERO_REEL_CLIPS.length;
export const HERO_REEL_DURATION = HERO_REEL_CLIP_SECONDS * HERO_REEL_CLIPS.length;
export const HERO_REEL_CELL_COUNT = 12;

export type HeroReelRGB = readonly [number, number, number];
export type HeroReelLightTrack = {
  frameRate: number;
  duration: number;
  width: number;
  height: number;
  samples: readonly (readonly HeroReelRGB[])[];
};

/** The video clock is authoritative, including seek, pause and the natural loop. */
export function heroReelTime(mediaTime: number) {
  if (!Number.isFinite(mediaTime)) return 0;
  const remainder = mediaTime % HERO_REEL_DURATION;
  return remainder < 0 ? remainder + HERO_REEL_DURATION : remainder;
}

export function heroReelFrame(mediaTime: number) {
  // Tolerate timestamp round-off at an exact frame boundary, without wrapping
  // the final frame early. No interpolation can bleed light across a hard cut.
  // VideoFrameCallback timestamps can be rounded to microseconds (0.733333
  // for frame22). Tolerance is in frames: 1e-4 = 3.3µs, not a visible blend.
  return Math.min(HERO_REEL_FRAME_COUNT - 1, Math.floor(heroReelTime(mediaTime) * HERO_REEL_FRAME_RATE + 1e-4));
}

export function heroReelClipIndex(mediaTime: number) {
  return Math.floor(heroReelFrame(mediaTime) / HERO_REEL_FRAMES_PER_CLIP);
}

/** Reject a stale or partial lighting bake instead of showing unrelated colors. */
export function validateHeroReelTrack(value: unknown): HeroReelLightTrack {
  if (!value || typeof value !== 'object') throw new Error('Hero reel lighting track is missing.');
  const track = value as Partial<HeroReelLightTrack>;
  if (track.frameRate !== HERO_REEL_FRAME_RATE || track.width !== 4 || track.height !== 3
    || typeof track.duration !== 'number' || Math.abs(track.duration - HERO_REEL_DURATION) > 1e-6
    || !Array.isArray(track.samples) || track.samples.length !== HERO_REEL_FRAME_COUNT) {
    throw new Error(`Hero reel lighting track must contain ${HERO_REEL_FRAME_COUNT} frames at ${HERO_REEL_FRAME_RATE} fps with a 4 × 3 grid.`);
  }
  for (const frame of track.samples) {
    if (!Array.isArray(frame) || frame.length !== HERO_REEL_CELL_COUNT) throw new Error('Hero reel lighting frame has an invalid cell count.');
    for (const rgb of frame) {
      if (!Array.isArray(rgb) || rgb.length !== 3 || rgb.some(channel => !Number.isFinite(channel) || channel < 0 || channel > 1)) {
        throw new Error('Hero reel lighting colors must be finite sRGB channels between 0 and 1.');
      }
    }
  }
  return track as HeroReelLightTrack;
}

/** Writes into caller-owned colors; the lighting renderer always receives linear values. */
export function writeHeroReelLighting(sample: readonly HeroReelRGB[], cells: readonly THREE.Color[], average: THREE.Color) {
  average.setRGB(0, 0, 0);
  for (let index = 0; index < HERO_REEL_CELL_COUNT; index++) {
    const rgb = sample[index];
    cells[index].setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
    average.add(cells[index]);
  }
  average.multiplyScalar(1 / HERO_REEL_CELL_COUNT);
  return average.r * 0.2126 + average.g * 0.7152 + average.b * 0.0722;
}
