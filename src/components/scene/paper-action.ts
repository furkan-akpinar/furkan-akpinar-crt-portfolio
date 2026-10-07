/** Scroll the intact sheet to its final reading position before the page curl. */
export function paperScrollOffset(paperHeight: number, viewportHeight: number, scroll: number): number {
  const extent = Math.max(0, paperHeight - viewportHeight);
  const progress = Number.isFinite(scroll) ? Math.min(1, Math.max(0, scroll)) : 0;
  return extent * progress;
}
