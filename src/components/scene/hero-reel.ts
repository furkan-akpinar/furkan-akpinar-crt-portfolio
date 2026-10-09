import * as THREE from 'three/webgpu';
import { publicAssetUrl } from '../../lib/public-asset.ts';
import { createVideoTextures } from './video-textures';
import {
  HERO_REEL_CELL_COUNT,
  HERO_REEL_CLIPS,
  HERO_REEL_FRAMES_PER_CLIP,
  heroReelFrame,
  heroReelTime,
  validateHeroReelTrack,
  writeHeroReelLighting,
  type HeroReelLightTrack,
} from './hero-reel-sampling';

const REEL_URL = publicAssetUrl('/media/hero-pinterest/showreel.mp4');
const LIGHT_TRACK_URL = publicAssetUrl('/media/hero-pinterest/light-tracks.json');
const ACTIVE_VIDEO = [0] as const;

/** One decoder and one presentation clock for all six short hero clips. */
export function createHeroReel() {
  const recordings = createVideoTextures([REEL_URL]);
  const video = recordings.videos[0];
  const texture = recordings.textures[0];
  texture.name = 'hero-short-video-reel';
  const cellColors = Array.from({ length: HERO_REEL_CELL_COUNT }, () => new THREE.Color(0, 0, 0));
  const averageColor = new THREE.Color(0, 0, 0);
  const diagnosticCells = Array.from({ length: HERO_REEL_CELL_COUNT }, () => [0, 0, 0]);
  const frameCallbacks = typeof video.requestVideoFrameCallback === 'function';
  const diagnostics = {
    source: REEL_URL,
    clipId: HERO_REEL_CLIPS[0] as typeof HERO_REEL_CLIPS[number],
    clipIndex: 0,
    mediaTime: 0,
    frame: 0,
    luminance: 0,
    cellColors: diagnosticCells,
    playing: false,
    paused: true,
    requestedPaused: true,
    hidden: document.hidden,
    blocked: false,
    ready: false,
    clock: frameCallbacks ? 'video-frame' : 'current-time',
    error: null as string | null,
  };
  const abortController = new AbortController();
  let disposed = false;
  let track: HeroReelLightTrack | null = null;
  let callbackId: number | null = null;
  let presentedTime = 0;
  let hasPresentedFrame = false;
  let sampledFrame = -1;

  function samplePresentedFrame(mediaTime: number) {
    presentedTime = mediaTime;
    const frame = heroReelFrame(mediaTime);
    diagnostics.mediaTime = heroReelTime(mediaTime);
    diagnostics.frame = frame;
    diagnostics.clipIndex = Math.floor(frame / HERO_REEL_FRAMES_PER_CLIP);
    diagnostics.clipId = HERO_REEL_CLIPS[diagnostics.clipIndex];
    if (!track || frame === sampledFrame) return;
    sampledFrame = frame;
    diagnostics.luminance = writeHeroReelLighting(track.samples[frame], cellColors, averageColor);
    for (let index = 0; index < HERO_REEL_CELL_COUNT; index++) {
      const cell = cellColors[index];
      const output = diagnosticCells[index];
      output[0] = cell.r;
      output[1] = cell.g;
      output[2] = cell.b;
    }
  }

  function presented(_now: number, metadata: VideoFrameCallbackMetadata) {
    if (disposed) return;
    hasPresentedFrame = true;
    samplePresentedFrame(metadata.mediaTime);
    callbackId = video.requestVideoFrameCallback(presented);
  }

  function seeked() {
    if (disposed || video.readyState < 2) return;
    // A paused seek can produce a decoded still without another RAF update.
    hasPresentedFrame = true;
    texture.needsUpdate = true;
    samplePresentedFrame(video.currentTime);
  }

  function syncPlaybackDiagnostics() {
    diagnostics.playing = !video.paused;
    diagnostics.paused = video.paused;
    diagnostics.blocked = recordings.diagnostics.blocked.length !== 0;
    if (recordings.diagnostics.error) diagnostics.error = recordings.diagnostics.error;
  }

  function visibilityChanged() {
    if (disposed) return;
    diagnostics.hidden = document.hidden;
    if (!document.hidden) return;
    // RAF can stop before another caller update when a tab is hidden. Pause
    // synchronously here; becoming visible leaves scene/reduced-motion policy
    // to the next caller update, and never starts playback from this listener.
    try {
      recordings.update(ACTIVE_VIDEO, true);
    } catch (error: unknown) {
      diagnostics.error = error instanceof Error ? error.message : String(error);
    }
    syncPlaybackDiagnostics();
  }

  video.addEventListener('seeked', seeked);
  document.addEventListener('visibilitychange', visibilityChanged);
  if (frameCallbacks) callbackId = video.requestVideoFrameCallback(presented);
  const trackTimeout = setTimeout(() => abortController.abort(), 30_000);
  const loadTrack = fetch(LIGHT_TRACK_URL, { signal: abortController.signal })
    .then(response => {
      if (!response.ok) throw new Error(`Cannot load hero reel lighting track (${response.status}).`);
      return response.json() as Promise<unknown>;
    })
    .then(value => {
      if (!disposed) track = validateHeroReelTrack(value);
    })
    .catch((error: unknown) => {
      if (!disposed) throw error;
    })
    .finally(() => clearTimeout(trackTimeout));
  const ready = Promise.all([recordings.ready, loadTrack]).then(() => {
    if (disposed) return;
    diagnostics.ready = true;
    samplePresentedFrame(hasPresentedFrame ? presentedTime : video.currentTime);
  }).catch((error: unknown) => {
    if (disposed) return;
    diagnostics.error = error instanceof Error ? error.message : String(error);
    throw error;
  });

  function update(paused: boolean) {
    if (disposed) return;
    diagnostics.hidden = document.hidden;
    recordings.update(ACTIVE_VIDEO, paused || document.hidden);
    if (!frameCallbacks || !hasPresentedFrame) samplePresentedFrame(video.currentTime);
    diagnostics.requestedPaused = paused;
    syncPlaybackDiagnostics();
  }

  return {
    texture, video, ready, cellColors, averageColor, diagnostics, update,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(trackTimeout);
      abortController.abort();
      if (callbackId !== null) video.cancelVideoFrameCallback(callbackId);
      video.removeEventListener('seeked', seeked);
      document.removeEventListener('visibilitychange', visibilityChanged);
      recordings.dispose();
      diagnostics.playing = false;
      diagnostics.paused = true;
      diagnostics.ready = false;
    },
  };
}
