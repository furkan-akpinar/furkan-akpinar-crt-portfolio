// The authored silhouette, lighting and centre positions remain shared by
// desktop and mobile. Only the way a finger moves between these poses differs.
export const APERTURE_CHANNELS = {
  radius: [-0.045, -0.017, 0.0228, 0.109, 0.270, 0.463, 0.739, 1.06, 1.50],
  exposure: [0, 0, 1, 1, 1, 0.20, 0.045, 0, 0],
  glow: [0, 0.035, 0.18, 0.40, 0.43, 0.065, 0.035, 0.012, 0],
  centerX: [0.5286, 0.5286, 0.5286, 0.54033, 0.53973, 0.532, 0.537, 0.537, 0.537],
  centerY: [0.603, 0.603, 0.6029, 0.52141, 0.55008, 0.637, 0.636, 0.636, 0.636],
  phase7: [-1.077, -1.077, -1.077, -2.604, -2.344, -1.8, -1, -0.5, 0],
  phase13: [-0.178, -0.178, -0.178, 1.492, 3.673, 5.6, 8.0, 11.0, 14.0],
} as const;

// Portrait corners used to disappear well before the finger finished its
// travel. Give those visible poses more distance, keeping the initial ember
// and full-cover endpoint. Wide screens still need the original late growth.
const PORTRAIT_TIMES = [0, .125, .25, .40, .56, .72, .86, .94, 1];
const keyTime = (index: number, pace: number) => index / 8 + (PORTRAIT_TIMES[index] - index / 8) * pace;

function tangent(values: readonly number[], index: number, pace: number): number {
  if (index === 0) return (values[1] - values[0]) / (keyTime(1, pace) - keyTime(0, pace));
  if (index === 8) return (values[8] - values[7]) / (keyTime(8, pace) - keyTime(7, pace));
  const before = keyTime(index, pace) - keyTime(index - 1, pace);
  const after = keyTime(index + 1, pace) - keyTime(index, pace);
  const left = (values[index] - values[index - 1]) / before;
  const right = (values[index + 1] - values[index]) / after;
  if (left * right <= 0) return 0;
  const a = 2 * after + before, b = after + 2 * before;
  return (a + b) / (a / left + b / right);
}

/** Continuous slopes, no overshoot, and no elapsed-time state to catch up. */
export function sampleApertureChannel(values: readonly number[], progress: number, mobile = false, aspect = 1): number {
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  if (!mobile) {
    const q = p * 8, index = Math.min(7, Math.floor(q));
    return values[index] + (values[index + 1] - values[index]) * (q - index);
  }
  const pace = Math.max(0, Math.min(1, (1.4 - aspect) / .4));
  let index = 0;
  while (index < 7 && p > keyTime(index + 1, pace)) index++;
  const span = keyTime(index + 1, pace) - keyTime(index, pace);
  const t = (p - keyTime(index, pace)) / span, t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * values[index]
    + (t3 - 2 * t2 + t) * span * tangent(values, index, pace)
    + (-2 * t3 + 3 * t2) * values[index + 1]
    + (t3 - t2) * span * tangent(values, index + 1, pace);
}
