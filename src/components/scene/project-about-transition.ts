import { clampProgress } from '../../config/scenes.ts';
import { SCROLL_SCREENS } from './runtime.ts';

/** The film stays at its approved resting camera throughout this scroll span. */
export const PROJECT_ABOUT_START_VH = 1.42;
export const PROJECT_ABOUT_END_VH = 5.6;
export const PROJECT_ABOUT_STEPS = 7;
/** Viewport fraction of finger travel for a full reveal; larger values feel slower. */
export const PROJECT_ABOUT_TOUCH_DISTANCE_VH = .75;
export const PROJECT_ABOUT_REST_TOLERANCE_VH = .002;

/** Absolute scroll sampling makes a stopped or reversed aperture deterministic. */
export function sampleProjectAbout(progress: number): number {
  const position = clampProgress(progress) * SCROLL_SCREENS;
  // A hero snap can round upward to a whole browser pixel. Keep the resting
  // film interactive instead of treating that sub-pixel difference as an opening.
  if (position <= PROJECT_ABOUT_START_VH + PROJECT_ABOUT_REST_TOLERANCE_VH) return 0;
  return clampProgress((position - PROJECT_ABOUT_START_VH)
    / (PROJECT_ABOUT_END_VH - PROJECT_ABOUT_START_VH));
}

/** A detent's pixel distance depends on the mouse settings, browser and zoom.
 * Never require exact 100/120px multiples, or turn a large distance into several
 * steps. Legacy detent information also covers mice configured for tiny deltas;
 * fine pixel input without that information retains continuous scrolling. */
export function projectAboutWheelSteps(deltaX: number, deltaY: number, deltaMode = 0, wheelDeltaY?: number): number {
  if (![deltaX, deltaY, deltaMode].every(Number.isFinite) || deltaY === 0 || Math.abs(deltaX) > 1) return 0;
  if (deltaMode !== 0) return Math.sign(deltaY);
  const detent = Math.abs(wheelDeltaY ?? 0);
  const hasDetent = Number.isFinite(detent) && detent >= 120 && Math.abs(detent / 120 - Math.round(detent / 120)) < .001;
  return hasDetent || Math.abs(deltaY) >= 24 ? Math.sign(deltaY) : 0;
}
