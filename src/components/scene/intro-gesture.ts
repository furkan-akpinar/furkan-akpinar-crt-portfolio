import { PROJECT_ABOUT_START_VH, PROJECT_ABOUT_END_VH, PROJECT_ABOUT_STEPS, PROJECT_ABOUT_TOUCH_DISTANCE_VH, PROJECT_ABOUT_TOUCH_DURATION } from './project-about-transition.ts';
import { ABOUT_CURL_START_VH, ABOUT_CURL_END_VH, ABOUT_CURL_DURATION, nextCurlTargetVh } from '../../lib/about-curl.ts';

/** Input arbitration: the caller owns scrolling, gallery changes, and navigation.
 * Reset with createIntroGestureState() when a menu/navigation command takes over.
 * Deltas must already be normalized to pixels, and time must be monotonic ms. */
export interface IntroGestureInput {
  deltaX: number;
  deltaY: number;
  time: number;
  scroll: number;
  viewportHeight: number;
  ready: boolean;
  menuOpen: boolean;
  /** Zero or omitted for continuous trackpad/touch input. */
  wheelSteps?: number;
  /** Controlled mobile touch input; desktop wheel/trackpad behavior is separate. */
  touch?: boolean;
}

export interface IntroGestureConfig {
  heroMaxVh: number;
  projectsStartVh: number;
  projectsSnapVh: number;
  projectsReverseMaxVh: number;
  projectsEndVh: number;
  quietMs: number;
  snapDurationMs: number;
  galleryDurationMs: number;
  triggerPx: number;
  settleTolerancePx: number;
}

export const introGestureDefaults: Readonly<IntroGestureConfig> = {
  heroMaxVh: 1.4,
  projectsStartVh: 1.4,
  projectsSnapVh: 1.42,
  projectsReverseMaxVh: PROJECT_ABOUT_START_VH,
  projectsEndVh: PROJECT_ABOUT_START_VH,
  quietMs: 200,
  snapDurationMs: 1500,
  galleryDurationMs: 650,
  // Deliberately more responsive than the live reference's raw-wheel threshold:
  // the current brief explicitly requires one downward gesture to complete entry.
  triggerPx: 12,
  settleTolerancePx: 3,
};

/** The established wheel snap curve, shared with the matching menu journey. */
export const introSnapEase = (t: number) => t * t * (3 - 2 * t);

type Axis = 'x' | 'y';
type Direction = 1 | -1;
type Latch = { type: 'snap'; targetVh: number; startedAt: number; durationMs?: number }
  | { type: 'gallery'; startedAt: number };

export interface IntroGestureState {
  lastEventTime: number;
  axis: Axis | null;
  direction: Direction | null;
  accumulated: number;
  latch: Latch | null;
  apertureTargetVh: number | null;
  curlTargetVh: number | null;
  scrubbingAperture: boolean;
}

export type IntroGestureAction = { type: 'pass' } | { type: 'block' }
  | { type: 'snap'; top: number; duration: number }
  | { type: 'scrub'; top: number }
  | { type: 'aperture'; top: number; duration: number }
  | { type: 'curl'; top: number; duration: number }
  | { type: 'gallery'; direction: Direction };

export function createIntroGestureState(): IntroGestureState {
  return { lastEventTime: -Infinity, axis: null, direction: null, accumulated: 0, latch: null, apertureTargetVh: null, curlTargetVh: null, scrubbingAperture: false };
}

export function reduceIntroGesture(
  previous: IntroGestureState,
  input: IntroGestureInput,
  overrides: Partial<IntroGestureConfig> = {},
): { state: IntroGestureState; action: IntroGestureAction } {
  const config = { ...introGestureDefaults, ...overrides };
  if (!input.ready || input.menuOpen) {
    return { state: createIntroGestureState(), action: { type: 'block' } };
  }
  if (![input.deltaX, input.deltaY, input.time, input.scroll, input.viewportHeight].every(Number.isFinite)
    || input.viewportHeight <= 0) {
    return { state: createIntroGestureState(), action: { type: 'pass' } };
  }
  // Empty events must not extend the inertia latch's quiet period.
  if (input.deltaX === 0 && input.deltaY === 0) return { state: previous, action: { type: 'pass' } };

  const axis: Axis = Math.abs(input.deltaX) > Math.abs(input.deltaY) ? 'x' : 'y';
  const delta = axis === 'x' ? input.deltaX : input.deltaY;
  const direction: Direction = delta > 0 ? 1 : -1;
  const quiet = input.time - previous.lastEventTime >= config.quietMs;
  const state: IntroGestureState = { ...previous, lastEventTime: input.time };
  const vh = Math.max(0, input.scroll) / input.viewportHeight;

  if (state.latch?.type === 'snap') {
    const settled = Math.abs(input.scroll - state.latch.targetVh * input.viewportHeight) <= config.settleTolerancePx;
    const elapsed = input.time - state.latch.startedAt >= (state.latch.durationMs ?? config.snapDurationMs);
    if (!(settled && elapsed && quiet)) return { state, action: { type: 'block' } };
    state.latch = null;
    state.accumulated = 0;
  } else if (state.latch?.type === 'gallery') {
    // A vertical gesture retains native section navigation, even after a gallery step.
    if (axis === 'x' && !(quiet && input.time - state.latch.startedAt >= config.galleryDurationMs)) {
      return { state, action: { type: 'block' } };
    }
    state.latch = null;
    state.accumulated = 0;
  }

  const reversed = state.direction !== direction;
  if (quiet || state.axis !== axis || reversed) state.accumulated = 0;
  state.axis = axis;
  state.direction = direction;
  state.accumulated += Math.abs(delta);

  const apertureStart = Math.floor(PROJECT_ABOUT_START_VH * input.viewportHeight);
  const apertureEnd = Math.ceil(PROJECT_ABOUT_END_VH * input.viewportHeight) + 2;
  if (input.touch && axis === 'y' && direction > 0 && !state.scrubbingAperture
    && vh >= config.projectsStartVh && input.scroll < apertureEnd) {
    if (state.accumulated < config.triggerPx) return { state, action: { type: 'block' } };
    // Reuse the existing locked scroll journey. Its finger stays consumed until
    // release, so the same swipe cannot skip into About after the reveal ends.
    state.accumulated = 0;
    state.apertureTargetVh = state.curlTargetVh = null;
    state.latch = { type: 'snap', targetVh: apertureEnd / input.viewportHeight,
      startedAt: input.time, durationMs: PROJECT_ABOUT_TOUCH_DURATION * 1000 };
    return { state, action: { type: 'snap', top: apertureEnd, duration: PROJECT_ABOUT_TOUCH_DURATION } };
  }
  const startsTouchScrub = direction > 0
    ? vh >= config.projectsStartVh && input.scroll < apertureEnd
    : input.scroll > apertureStart + config.settleTolerancePx && input.scroll + input.deltaY <= apertureEnd;
  if (input.touch && axis === 'y' && (state.scrubbingAperture || startsTouchScrub)) {
    // Retain this drag's ownership at both endpoints. Reversing the held finger
    // scrubs back; only a fresh touch can leave for Hero or scroll through About.
    state.scrubbingAperture = true;
    state.accumulated = 0;
    state.apertureTargetVh = state.curlTargetVh = null;
    const basis = Math.max(apertureStart, Math.min(apertureEnd, input.scroll));
    // When arriving from About, consume its outside distance at the normal rate.
    const delta = input.deltaY + Math.max(0, input.scroll - apertureEnd);
    const gain = (apertureEnd - apertureStart) / (PROJECT_ABOUT_TOUCH_DISTANCE_VH * input.viewportHeight);
    return { state, action: { type: 'scrub', top: Math.max(apertureStart, Math.min(apertureEnd, basis + delta * gain)) } };
  }

  const entering = axis === 'y' && direction > 0 && vh < config.heroMaxVh;
  const restToleranceVh = config.settleTolerancePx / input.viewportHeight;
  const returning = axis === 'y' && direction < 0
    && vh >= config.projectsStartVh && vh <= config.projectsReverseMaxVh + restToleranceVh;
  const browsing = axis === 'x' && vh >= config.projectsStartVh && vh <= config.projectsEndVh + restToleranceVh;
  // An immediate reversal can arrive before the first animation frame leaves an
  // endpoint. Cancel that unfinished target inside the aperture, not via hero.
  const aperturePending = state.apertureTargetVh !== null
    && Math.abs(input.scroll - state.apertureTargetVh * input.viewportHeight) > config.settleTolerancePx;
  const atAperture = axis === 'y' && vh >= config.projectsStartVh
    && vh <= PROJECT_ABOUT_END_VH + config.settleTolerancePx / input.viewportHeight
    && (aperturePending || (direction > 0 ? vh < PROJECT_ABOUT_END_VH : vh > PROJECT_ABOUT_START_VH + restToleranceVh));
  const steps = Math.abs(input.wheelSteps ?? 0);
  if (atAperture && Number.isFinite(steps) && steps > 0) {
    const span = PROJECT_ABOUT_END_VH - PROJECT_ABOUT_START_VH;
    // Continue rapid notches from their scheduled target; a direction reversal
    // starts from the visible position, so an unfinished forward queue is dropped.
    const basis = Math.max(PROJECT_ABOUT_START_VH, !reversed && state.apertureTargetVh !== null ? state.apertureTargetVh : vh);
    const step = (basis - PROJECT_ABOUT_START_VH) / span * PROJECT_ABOUT_STEPS;
    // Native scroll offsets round to whole pixels, including at intermediate holds.
    const rounded = Math.abs(step - Math.round(step)) < .01 ? Math.round(step) : step;
    const next = direction > 0 ? Math.floor(rounded) + steps : Math.ceil(rounded) - steps;
    const bounded = Math.min(PROJECT_ABOUT_STEPS, Math.max(0, next));
    const targetVh = PROJECT_ABOUT_START_VH + bounded / PROJECT_ABOUT_STEPS * span;
    state.apertureTargetVh = targetVh;
    state.accumulated = 0;
    const pixels = targetVh * input.viewportHeight;
    // Endpoint rounding must never leave a residual mask or stop before About.
    const top = bounded === 0 ? Math.floor(pixels) : bounded === PROJECT_ABOUT_STEPS ? Math.ceil(pixels) + 2 : Math.round(pixels);
    return { state, action: { type: 'aperture', top, duration: .72 } };
  }
  state.apertureTargetVh = null;
  const curlPending = state.curlTargetVh !== null
    && Math.abs(input.scroll - state.curlTargetVh * input.viewportHeight) > config.settleTolerancePx;
  const projectedVh = (input.scroll + input.deltaY) / input.viewportHeight;
  // Capture a coarse event that enters the interval, even if the user's mouse
  // setting would otherwise jump over the first hold or the entire transition.
  const enteringCurl = direction > 0
    ? vh >= PROJECT_ABOUT_END_VH && vh < ABOUT_CURL_START_VH && projectedVh >= ABOUT_CURL_START_VH
    : vh > ABOUT_CURL_END_VH && projectedVh <= ABOUT_CURL_END_VH;
  const atCurl = axis === 'y'
    && (enteringCurl || (vh >= ABOUT_CURL_START_VH - restToleranceVh && vh <= ABOUT_CURL_END_VH + restToleranceVh
      && (curlPending || (direction > 0 ? vh < ABOUT_CURL_END_VH : vh > ABOUT_CURL_START_VH + restToleranceVh))));
  if (atCurl && Number.isFinite(steps) && steps > 0) {
    // Keep rapid forward detents, but discard their unfinished queue as soon as
    // input reverses. The existing scroll animation retargets from its live pose.
    const queued = !reversed && state.curlTargetVh !== null
      && input.time - previous.lastEventTime < ABOUT_CURL_DURATION * 1000;
    const basis = queued ? (direction > 0 ? Math.max(vh, state.curlTargetVh!) : Math.min(vh, state.curlTargetVh!)) : vh;
    const targetVh = nextCurlTargetVh(basis, direction);
    state.curlTargetVh = targetVh;
    state.accumulated = 0;
    const pixels = targetVh * input.viewportHeight;
    const top = targetVh === ABOUT_CURL_START_VH ? Math.floor(pixels)
      : targetVh === ABOUT_CURL_END_VH ? Math.ceil(pixels) + 2 : Math.round(pixels);
    return { state, action: { type: 'curl', top, duration: ABOUT_CURL_DURATION } };
  }
  state.curlTargetVh = null;
  if (!(entering || returning || browsing)) {
    state.accumulated = 0;
    return { state, action: { type: 'pass' } };
  }
  if (state.accumulated < config.triggerPx) return { state, action: { type: 'block' } };

  state.accumulated = 0;
  if (browsing) {
    state.latch = { type: 'gallery', startedAt: input.time };
    return { state, action: { type: 'gallery', direction } };
  }
  const targetVh = returning ? 0 : config.projectsSnapVh;
  state.latch = { type: 'snap', targetVh, startedAt: input.time };
  return { state, action: { type: 'snap', top: targetVh * input.viewportHeight, duration: config.snapDurationMs / 1000 } };
}
