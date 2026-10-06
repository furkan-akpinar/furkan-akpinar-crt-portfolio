import assert from 'node:assert/strict';
import test from 'node:test';
import { createSceneLifecycle, createSceneResizeQueue, disposeUnownedSceneRenderer } from '../src/components/scene/scene-lifecycle.ts';

const flushMicrotasks = async () => { await Promise.resolve(); await Promise.resolve(); };
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('pipeline construction failure enters fallback once and stops subsequent frames and device-loss callbacks', () => {
  const failures: unknown[] = [];
  const lifecycle = createSceneLifecycle(error => failures.push(error));
  const error = new Error('canvas allocation failed');
  assert.equal(lifecycle.run(() => { throw error; }), undefined);
  let frames = 0;
  lifecycle.run(() => frames++);
  lifecycle.fail(new Error('device lost'));
  assert.equal(frames, 0);
  assert.deepEqual(failures, [error]);
});

test('unmount suppresses late initialization and device errors without reporting fallback', () => {
  const failures: unknown[] = [];
  const lifecycle = createSceneLifecycle(error => failures.push(error));
  lifecycle.dispose();
  lifecycle.dispose();
  lifecycle.fail(new Error('late device loss'));
  let constructions = 0;
  lifecycle.run(() => constructions++);
  assert.equal(constructions, 0);
  assert.equal(lifecycle.active, false);
  assert.deepEqual(failures, []);
});

test('a rejected initialization releases the backend without calling renderer.dispose and retrying init', async () => {
  let backendDisposals = 0;
  await disposeUnownedSceneRenderer({
    hasInitialized: () => false,
    dispose: async () => { assert.fail('uninitialized renderer.dispose would retry init'); },
    backend: { dispose: async () => { backendDisposals++; } },
  });
  assert.equal(backendDisposals, 1);
});

test('a factory failure after successful initialization disposes the full renderer exactly once', async () => {
  let rendererDisposals = 0;
  await disposeUnownedSceneRenderer({
    hasInitialized: () => true,
    dispose: async () => { rendererDisposals++; },
    backend: { dispose: async () => { assert.fail('full renderer disposal already owns backend cleanup'); } },
  });
  assert.equal(rendererDisposals, 1);
});

test('resize bursts configure only the latest dimensions and serialize pending configuration', async () => {
  const calls: {width: number; height: number}[] = [];
  const first = deferred();
  const queue = createSceneResizeQueue({width:390,height:844}, async size => {
    calls.push(size);
    if (calls.length === 1) await first.promise;
  }, error => { throw error; });
  queue.request({width:390,height:844});
  queue.request({width:400,height:844});
  queue.request({width:410,height:844});
  await flushMicrotasks();
  assert.deepEqual(calls, [{width:410,height:844}]);
  queue.request({width:420,height:844});
  queue.request({width:430,height:844});
  await flushMicrotasks();
  assert.equal(calls.length, 1);
  first.resolve();
  await flushMicrotasks();
  assert.deepEqual(calls, [{width:410,height:844},{width:430,height:844}]);
  queue.request({width:430,height:844});
  queue.request({width:0,height:844});
  queue.request({width:NaN,height:844});
  await flushMicrotasks();
  assert.equal(calls.length, 2);
  queue.dispose();
});

test('disposed resize queues cancel queued work and ignore a late rejected configuration', async () => {
  const running = deferred();
  let calls = 0;
  const failures: unknown[] = [];
  const queue = createSceneResizeQueue({width:390,height:844}, () => { calls++; return running.promise; }, error => failures.push(error));
  queue.request({width:400,height:844});
  await flushMicrotasks();
  queue.request({width:410,height:844});
  queue.dispose();
  running.reject(new Error('context destroyed during resize'));
  await flushMicrotasks();
  assert.equal(calls, 1);
  assert.deepEqual(failures, []);
});

test('resize rejection triggers fallback once and stops further configuration', async () => {
  const error = new Error('render target allocation failed');
  const failures: unknown[] = [];
  let calls = 0;
  const queue = createSceneResizeQueue({width:390,height:844}, async () => { calls++; throw error; }, failure => failures.push(failure));
  queue.request({width:400,height:844});
  await flushMicrotasks();
  queue.request({width:410,height:844});
  await flushMicrotasks();
  assert.equal(calls, 1);
  assert.deepEqual(failures, [error]);
});
