/** Reference: one additional mark every 450 ms, then all off for one beat. */
export function heroPromptCount(time: number, reducedMotion = false) {
  if (reducedMotion) return 3;
  return Math.floor(Math.max(0, time) / 0.45) % 4;
}
