type Viewport = { width: number; height: number };

/** Native browser chrome changes height during touch scrolling. Keep the story's
 * distance unit until width/orientation changes; desktop resizes still refit. */
export function storyViewport(previous: Viewport, visible: Viewport, touch: boolean): Viewport {
  return touch && previous.width === visible.width ? previous : visible;
}

/** Only genuine layout changes remap the current pose to a new scroll unit. */
export function resizeScrollTarget(scroll: number, previous: Viewport, next: Viewport): number | null {
  if (previous.width === next.width && previous.height === next.height) return null;
  return scroll / Math.max(1, previous.height) * Math.max(1, next.height);
}
