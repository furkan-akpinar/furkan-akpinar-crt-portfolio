export interface CanvasActionBounds { x: number; y: number; width: number; height: number }

/** About begins directly below its fixed header; there is no leading photograph. */
export function paperEntryOffset(viewportWidth: number): number {
  // Keep the viewport argument so both texture and scene use the same entry API.
  void viewportWidth;
  return 0;
}

/** Scroll the intact sheet to its final reading position before the page curl. */
export function paperScrollOffset(paperHeight: number, viewportHeight: number, scroll: number, entryOffset = 0): number {
  const extent = Math.max(0, paperHeight - viewportHeight);
  const start = Math.min(extent, Math.max(0, Number.isFinite(entryOffset) ? entryOffset : 0));
  const progress = Number.isFinite(scroll) ? Math.min(1, Math.max(0, scroll)) : 0;
  return start + (extent - start) * progress;
}
