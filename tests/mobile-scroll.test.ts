import assert from 'node:assert/strict';
import test from 'node:test';
import { clampMobileScroll, createMobileScroll, mobileScrollAxis, mobileScrollMomentum, type ScrollDriver } from '../src/components/scene/mobile-scroll.ts';

test('virtual distance cannot escape its finite scene range', () => {
  assert.equal(clampMobileScroll(-10, 200), 0);
  assert.equal(clampMobileScroll(210, 200), 200);
  assert.equal(clampMobileScroll(125.5, 200), 125.5);
  for (const invalid of [NaN, Infinity, -Infinity]) {
    assert.equal(clampMobileScroll(invalid, 200), 0);
    assert.equal(clampMobileScroll(100, invalid), 0);
  }
  assert.equal(clampMobileScroll(100, -1), 0);
});

test('tap jitter leaves native clicks alone while a drag chooses exactly one axis', () => {
  for (const [x, y] of [[0, 0], [3, -3], [-3.99, 0]]) assert.equal(mobileScrollAxis(x, y), null);
  assert.equal(mobileScrollAxis(20, -5), 'x');
  assert.equal(mobileScrollAxis(-5, 20), 'y');
  assert.equal(mobileScrollAxis(0, -4), 'y');
  assert.equal(mobileScrollAxis(NaN, 100), null);
});

test('release momentum is bounded in both directions and stops exactly at scene edges', () => {
  const forward = mobileScrollMomentum(500, 50, 0, 1000);
  const reverse = mobileScrollMomentum(500, -50, 0, 1000);
  assert.ok(forward.top > 500 && forward.top <= 700);
  assert.equal(500 - reverse.top, forward.top - 500);
  assert.ok(forward.duration > 0 && forward.duration < 0.5);
  assert.equal(mobileScrollMomentum(990, 1, 0, 1000).top, 1000);
  assert.equal(mobileScrollMomentum(10, -1, 0, 1000).top, 0);
  assert.deepEqual(mobileScrollMomentum(1000, 1, 0, 1000), { top: 1000, duration: 0 });
  assert.deepEqual(mobileScrollMomentum(0, -1, 0, 1000), { top: 0, duration: 0 });
});

test('holding before release or a stationary finger never starts stale inertia', () => {
  for (const [velocity, idle] of [[1, 101], [0, 0], [0.079, 0], [NaN, 0], [1, Infinity], [1, -1]]) {
    assert.deepEqual(mobileScrollMomentum(500, velocity, idle, 1000), { top: 500, duration: 0 });
  }
  assert.ok(mobileScrollMomentum(500, -0.2, 0, 1000).top < 500);
});

function withTouchDriver(run: (state: {
  driver: ScrollDriver;
  read: () => number;
  calls: number[][];
  touch: (type: string, points: Array<[number, number]>) => Event;
  zoom: (scale: number) => void;
  nativeZoom: () => string | undefined;
}) => void) {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  // No scrollTo/scrollY exist on this window: input must only use read/write.
  const visualViewport = Object.assign(new EventTarget(), { scale: 1 });
  Object.defineProperty(globalThis, 'window', { value: Object.assign(new EventTarget(), { visualViewport }), configurable: true });
  const target = Object.assign(new EventTarget(), { clientHeight: 820, dataset: {} as Record<string, string> });
  let position = 100;
  const calls: number[][] = [];
  const driver = createMobileScroll({
    target: target as unknown as HTMLElement,
    read: () => position,
    write: value => { position = value; },
    limit: () => 1000,
    reducedMotion: true,
    arbitrate: (dx, dy) => { calls.push([dx, dy]); return true; },
  });
  const touch = (type: string, points: Array<[number, number]>) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperty(event, 'touches', { value: points.map(([clientX, clientY], identifier) => ({ identifier, clientX, clientY })) });
    target.dispatchEvent(event);
    return event;
  };
  try { run({ driver, read: () => position, calls, touch,
    zoom: scale => { visualViewport.scale = scale; visualViewport.dispatchEvent(new Event('resize')); },
    nativeZoom: () => target.dataset.nativeZoom }); }
  finally {
    driver.destroy();
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}

test('controlled touch moves 1:1 while taps, horizontal gallery drags and pinch remain separate', () => {
  withTouchDriver(({ read, calls, touch }) => {
    assert.equal(touch('touchstart', [[200, 400]]).defaultPrevented, false);
    assert.equal(touch('touchmove', [[201, 398]]).defaultPrevented, false);
    touch('touchend', []);
    assert.equal(read(), 100);
    touch('touchstart', [[200, 400]]);
    assert.equal(touch('touchmove', [[200, 350]]).defaultPrevented, true);
    assert.equal(read(), 150);
    touch('touchmove', [[200, 360]]);
    assert.equal(read(), 140);
    touch('touchend', []);
    assert.deepEqual(calls, [[0, 50], [0, -10]]);
    touch('touchstart', [[200, 400]]);
    touch('touchmove', [[100, 395]]);
    touch('touchend', []);
    assert.equal(calls.length, 2, 'horizontal input must not also trigger the scene reducer');
    touch('touchstart', [[200, 400]]);
    assert.equal(touch('touchmove', [[190, 390], [240, 420]]).defaultPrevented, false);
    touch('touchmove', [[190, 350]]);
    touch('touchend', []);
    assert.equal(read(), 140, 'a pinch does not turn into a one-finger drag midway through');
  });
});

test('a zoomed visual viewport keeps one-finger panning native without advancing the scene', () => {
  withTouchDriver(({ driver, read, calls, touch, zoom, nativeZoom }) => {
    for (const scale of [2, 0.9]) {
      zoom(scale);
      assert.equal(nativeZoom(), 'true');
      touch('touchstart', [[200, 400]]);
      assert.equal(touch('touchmove', [[200, 300]]).defaultPrevented, false);
      touch('touchend', []);
    }
    assert.equal(read(), 100);
    assert.equal(calls.length, 0);
    zoom(1);
    assert.equal(nativeZoom(), 'false');
    touch('touchstart', [[200, 400]]);
    zoom(1.5);
    assert.equal(touch('touchmove', [[200, 350]]).defaultPrevented, false);
    zoom(1);
    assert.equal(touch('touchmove', [[200, 300]]).defaultPrevented, false);
    touch('touchend', []);
    assert.equal(read(), 100, 'zooming back does not resume a discarded drag');
    touch('touchstart', [[200, 400]]);
    assert.equal(touch('touchmove', [[200, 350]]).defaultPrevented, true);
    touch('touchend', []);
    assert.equal(read(), 150);
    driver.destroy();
    assert.equal(nativeZoom(), undefined);
    zoom(2);
    assert.equal(nativeZoom(), undefined, 'destroy removes the viewport listener as well');
  });
});

test('stopped drivers only accept forced navigation and destroyed drivers remove touch ownership', () => {
  withTouchDriver(({ driver, read, touch }) => {
    driver.stop();
    driver.scrollTo(300, { immediate: true });
    assert.equal(read(), 100);
    driver.scrollTo(300, { immediate: true, force: true });
    assert.equal(read(), 300);
    touch('touchstart', [[200, 400]]);
    touch('touchmove', [[200, 300]]);
    assert.equal(read(), 300);
    touch('touchend', []);
    driver.start();
    touch('touchstart', [[200, 400]]);
    touch('touchmove', [[200, 350]]);
    touch('touchend', []);
    assert.equal(read(), 350);
    driver.destroy();
    touch('touchstart', [[200, 400]]);
    assert.equal(touch('touchmove', [[200, 300]]).defaultPrevented, false);
    driver.scrollTo(900, { immediate: true, force: true });
    assert.equal(read(), 350);
  });
});

test('rotation discards coordinates from a finger still held in the old viewport', () => {
  withTouchDriver(({ driver, read, touch }) => {
    touch('touchstart', [[200, 400]]);
    touch('touchmove', [[200, 350]]);
    assert.equal(read(), 150);
    driver.resize();
    assert.equal(touch('touchmove', [[200, 200]]).defaultPrevented, false);
    touch('touchend', []);
    assert.equal(read(), 150);
    touch('touchstart', [[200, 400]]);
    touch('touchmove', [[200, 350]]);
    touch('touchend', []);
    assert.equal(read(), 200);
  });
});


test('a locked immediate journey consumes the current finger through release, including reduced motion', () => {
  withTouchDriver(({ driver, read, touch }) => {
    touch('touchstart', [[200, 500]]);
    driver.scrollTo(600, { lock: true, immediate: true, force: true });
    assert.equal(read(), 600);
    touch('touchmove', [[200, 400]]);
    touch('touchmove', [[200, 450]]);
    touch('touchend', []);
    assert.equal(read(), 600, 'the original finger cannot overshoot or reverse a completed journey');
    touch('touchstart', [[200, 500]]);
    touch('touchmove', [[200, 450]]);
    touch('touchend', []);
    assert.equal(read(), 650, 'a new gesture regains control');
  });
});
