/** Stop all future scene work after the first failure or an unmount. */
export function createSceneLifecycle(onFailure: (error: unknown) => void) {
  let active = true;
  function fail(error: unknown) {
    if (!active) return;
    active = false;
    onFailure(error);
  }
  return {
    get active() { return active; },
    fail,
    run<T>(work: () => T): T | undefined {
      if (!active) return;
      try { return work(); } catch (error) { fail(error); }
    },
    dispose() { active = false; },
  };
}

/** A rejected Fiber renderer factory has not transferred ownership to Fiber. */
export async function disposeUnownedSceneRenderer(renderer: {
  hasInitialized(): boolean;
  dispose(): Promise<void>;
  backend: object;
}) {
  if (renderer.hasInitialized()) await renderer.dispose();
  // Three r186's renderer.dispose() calls setAnimationLoop(), which retries init
  // on an uninitialized renderer. Release the partially initialized backend directly.
  else await (renderer.backend as { dispose(): Promise<void> }).dispose();
}

type SceneSize = { width: number; height: number };
const sameSize = (a: SceneSize, b: SceneSize) => a.width === b.width && a.height === b.height;

/** Serialize async Fiber configuration and keep only the latest observed size. */
export function createSceneResizeQueue(
  initialSize: SceneSize,
  apply: (size: SceneSize) => Promise<unknown>,
  onFailure: (error: unknown) => void,
) {
  let active = true, scheduled = false, running = false;
  let applied = { ...initialSize };
  let pending: SceneSize | null = null;

  function schedule() {
    if (!active || scheduled || running) return;
    scheduled = true;
    queueMicrotask(() => { void flush(); });
  }
  async function flush() {
    scheduled = false;
    if (!active || !pending) return;
    const next = pending;
    pending = null;
    if (sameSize(applied, next)) return;
    running = true;
    try {
      await apply(next);
      applied = next;
    } catch (error) {
      if (active) {
        active = false;
        pending = null;
        onFailure(error);
      }
    } finally {
      running = false;
      if (pending) schedule();
    }
  }
  return {
    request(size: SceneSize) {
      if (!active || !Number.isFinite(size.width) || !Number.isFinite(size.height)
        || size.width <= 0 || size.height <= 0) return;
      if (!running && !pending && sameSize(applied, size)) return;
      pending = { width: size.width, height: size.height };
      schedule();
    },
    dispose() { active = false; pending = null; },
  };
}
