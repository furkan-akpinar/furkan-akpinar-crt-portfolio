const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

/** Absolute progress keeps the telephone exit identical when scrolling backwards. */
export function contactPhoneElevation(progress: number, mobile: boolean) {
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  const entrance = p < 0.45 ? -3.3 + 3.6 * smooth(p / 0.45) : 0.3 + smooth((p - 0.45) / 0.55) * 10;
  if (mobile) {
    // Keep the early foreground low, then clear the copy during the shallow
    // camera turn. The bounded lift follows progress in either scroll direction.
    const cameraTurn = smooth((p - 0.26) / 0.3);
    const closingLift = 0.68 * smooth((p - 0.34) / 0.1) * (1 - smooth((p - 0.54) / 0.085));
    return entrance - 0.45 - 0.28 * cameraTurn + closingLift;
  }
  // Preserve the desktop separation established by the recovery regression.
  return entrance - (mobile ? 0 : 0.7) + (mobile ? 0 : 2.15 * smooth((p - 0.23) / 0.18));
}

export function contactCopyTop(progress: number, height: number, scale: number, mobile: boolean) {
  const start = mobile ? 0.27 : 0.26;
  const travel = Math.max(0, Math.min(1, (progress - start) / (1 - start)));
  return (height + 100) * (1 - travel) - (mobile ? 255 : 455) * scale * travel;
}
