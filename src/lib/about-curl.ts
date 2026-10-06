/** The reference recording contains about 17 distinct visible advances. This is
 * an observed motion count, not recovered mouse-wheel telemetry. */
export const ABOUT_CURL_STEPS = 17;
export const ABOUT_CURL_DURATION = .6;
export const ABOUT_CURL_START = .72;
export const ABOUT_CURL_START_VH = 5.6 + 8 * ABOUT_CURL_START;
export const ABOUT_CURL_END_VH = 13.6;

/** Geometry samples absolute About progress. No time, velocity or direction is
 * part of the shape, so a stopped or reversed sheet always has the same pose. */
export function sampleCurlProgress(aboutProgress: number): number {
  if (!Number.isFinite(aboutProgress)) return 0;
  return Math.min(1, Math.max(0, (aboutProgress - ABOUT_CURL_START) / (1 - ABOUT_CURL_START)));
}

/** One physical-looking wheel event advances to the next hold. Input distance
 * does not multiply steps; touch and fine pixel input bypass this function. */
export function nextCurlTargetVh(positionVh: number, direction: 1 | -1): number {
  const span = ABOUT_CURL_END_VH - ABOUT_CURL_START_VH;
  const progress = Number.isFinite(positionVh)
    ? Math.min(1, Math.max(0, (positionVh - ABOUT_CURL_START_VH) / span)) : 0;
  const step = progress * ABOUT_CURL_STEPS;
  // Whole-pixel browser offsets can land slightly to either side of a hold.
  const rounded = Math.abs(step - Math.round(step)) < .01 ? Math.round(step) : step;
  const next = direction > 0 ? Math.floor(rounded) + 1 : Math.ceil(rounded) - 1;
  const bounded = Math.min(ABOUT_CURL_STEPS, Math.max(0, next));
  return ABOUT_CURL_START_VH + bounded / ABOUT_CURL_STEPS * span;
}
