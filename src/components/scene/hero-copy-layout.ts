/** One position for the canvas label and its accessible DOM hit target. */
export function heroPromptLayout(width: number, height: number) {
  const mobile = width < 900;
  const scale = Math.min(width / 1440, height / 900, 1);
  const x = mobile ? width / 2 : 106 * scale + Math.max(0, width - 1440) * 0.153;
  const baseline = mobile ? 417 : 716 * scale + Math.max(0, height - 900) * 0.568;
  return {
    x, baseline,
    fontSize: mobile ? Math.min(23, width * 0.059) : 28 * scale,
    arrowSize: mobile ? 26 * Math.min(1, width / 390) : 36 * scale,
    arrowGap: mobile ? 24 * Math.min(1, width / 390) : 16 * scale,
    arrowY: baseline + (mobile ? 31 : -10 * scale),
    arrowDirection: mobile ? 'down' as const : 'right' as const,
    left: mobile ? width * 0.05 : x - 12 * scale,
    top: baseline - (mobile ? 34 : 34 * scale),
    width: mobile ? width * 0.9 : 440 * scale,
    height: mobile ? 86 : Math.max(44, 60 * scale),
  };
}
