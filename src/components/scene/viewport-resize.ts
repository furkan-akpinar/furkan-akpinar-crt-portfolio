type Viewport = { width: number; height: number };

/** Scene spans use viewport height: retain the same pose when that unit changes.
 * The caller coalesces toolbar/resize notifications before applying this target. */
export function resizeScrollTarget(scroll: number, previous: Viewport, next: Viewport): number | null {
  if (previous.width === next.width && previous.height === next.height) return null;
  return scroll / Math.max(1, previous.height) * Math.max(1, next.height);
}
