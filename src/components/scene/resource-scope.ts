type Disposable = { dispose(): void };

/** Own partially built scenes too: construction failure must release earlier assets. */
export function createResourceScope() {
  const resources: Disposable[] = [];
  let disposed = false;
  return {
    own<T extends Disposable>(resource: T): T {
      if (disposed) resource.dispose();
      else resources.push(resource);
      return resource;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const resource of resources.reverse()) {
        try { resource.dispose(); } catch (error) { console.warn('Resource cleanup failed:', error); }
      }
      resources.length = 0;
    },
  };
}
