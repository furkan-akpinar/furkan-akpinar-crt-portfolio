import assert from 'node:assert/strict';
import test from 'node:test';
import { createIntroGestureState, reduceIntroGesture, type IntroGestureInput } from '../src/components/scene/intro-gesture.ts';

const wheel = (values: Partial<IntroGestureInput> = {}): IntroGestureInput => ({
  deltaX: 0, deltaY: 100, time: 0, scroll: 0, viewportHeight: 1000, ready: true, menuOpen: false, ...values,
});

test('one mouse wheel completes entry from rest and from a partially scrolled monitor approach', () => {
  for (const scroll of [0, 200, 900, 1399]) {
    const result = reduceIntroGesture(createIntroGestureState(), wheel({ scroll }));
    assert.deepEqual(result.action, { type: 'snap', top: 1420, duration: 1.5 });
  }
  assert.equal(reduceIntroGesture(createIntroGestureState(), wheel({ scroll: 1420 })).action.type, 'pass');
});

test('trackpad ramp and a long inertial tail produce exactly one snap', () => {
  let state = createIntroGestureState();
  const actions = [];
  const deltas = [2, 3, 4, 6, 12, 30, 45, 60, 50, 35, 20, 10, 5, 2];
  for (let index = 0; index < 90; index++) {
    const result = reduceIntroGesture(state, wheel({
      deltaY: deltas[index] ?? 1, time: index * 25, scroll: index > 50 ? 1420 : index * 25,
    }));
    state = result.state;
    actions.push(result.action.type);
  }
  assert.equal(actions.filter(type => type === 'snap').length, 1);
  assert.equal(actions.filter(type => type === 'pass').length, 0);
  assert.equal(reduceIntroGesture(state, wheel({ time: 2600, scroll: 1420 })).action.type, 'pass');
});

test('quiet alone cannot unlock an unfinished transition; settlement alone cannot leak an inertia tail', () => {
  const entered = reduceIntroGesture(createIntroGestureState(), wheel()).state;
  assert.equal(reduceIntroGesture(entered, wheel({ time: 2000, scroll: 900 })).action.type, 'block');
  const tail = reduceIntroGesture(entered, wheel({ time: 1500, scroll: 1420, deltaY: 1 })).state;
  // The first event was quiet and settled, so it is native. Test the continuously arriving case separately.
  assert.equal(tail.latch, null);
  const inMotion = reduceIntroGesture(entered, wheel({ time: 1200, scroll: 1420 })).state;
  assert.equal(reduceIntroGesture(inMotion, wheel({ time: 1300, scroll: 1420 })).action.type, 'block');
});

test('reverse snaps from the projects entrance, then allows a fresh forward gesture after settlement', () => {
  for (const scroll of [1400, 1420, 1421, 1422]) {
    const reverse = reduceIntroGesture(createIntroGestureState(), wheel({ deltaY: -100, scroll }));
    assert.deepEqual(reverse.action, { type: 'snap', top: 0, duration: 1.5 });
    assert.equal(reduceIntroGesture(reverse.state, wheel({ time: 1500, scroll: 0 })).action.type, 'snap');
  }
  for (const scroll of [1424, 1600, 1750]) {
    assert.equal(reduceIntroGesture(createIntroGestureState(), wheel({ deltaY: -100, scroll })).action.type, 'pass');
  }
  assert.equal(reduceIntroGesture(createIntroGestureState(), wheel({ deltaY: -100, scroll: 1800 })).action.type, 'pass');
});

test('gallery horizontal gestures advance once per burst while vertical wheel remains section scroll', () => {
  const first = reduceIntroGesture(createIntroGestureState(), wheel({ deltaX: 100, deltaY: 1, scroll: 1420 }));
  assert.deepEqual(first.action, { type: 'gallery', direction: 1 });
  const tail = reduceIntroGesture(first.state, wheel({ deltaX: 30, deltaY: 0, time: 80, scroll: 1420 }));
  assert.equal(tail.action.type, 'block');
  assert.deepEqual(reduceIntroGesture(tail.state, wheel({ deltaX: -100, deltaY: 0, time: 800, scroll: 1420 })).action,
    { type: 'gallery', direction: -1 });
  assert.equal(reduceIntroGesture(first.state, wheel({ time: 90, scroll: 1420 })).action.type, 'pass');
  assert.equal(reduceIntroGesture(createIntroGestureState(), wheel({ deltaX: 100, deltaY: 0, scroll: 3800 })).action.type, 'pass');
});

test('vertical-dominant diagonal events do not accidentally turn the gallery', () => {
  assert.equal(reduceIntroGesture(createIntroGestureState(), wheel({ deltaX: 60, deltaY: 70, scroll: 1420 })).action.type, 'pass');
});

test('small jitters and separated microgestures do not accumulate into accidental transitions', () => {
  let state = createIntroGestureState();
  for (const time of [0, 300, 600, 900]) {
    const result = reduceIntroGesture(state, wheel({ deltaY: 4, time }));
    state = result.state;
    assert.equal(result.action.type, 'block');
  }
  assert.equal(reduceIntroGesture(state, wheel({ deltaY: -8, time: 920 })).action.type, 'pass');
});

test('menu or boot gating clears pending input and navigation can explicitly reset a latch', () => {
  const latched = reduceIntroGesture(createIntroGestureState(), wheel()).state;
  for (const gating of [{ ready: false }, { menuOpen: true }]) {
    const result = reduceIntroGesture(latched, wheel(gating));
    assert.equal(result.action.type, 'block');
    assert.deepEqual(result.state, createIntroGestureState());
  }
  assert.equal(reduceIntroGesture(createIntroGestureState(), wheel({ scroll: 5000 })).action.type, 'pass');
});

test('resize keeps snap settlement proportional to the current viewport, and reduction does not mutate prior state', () => {
  const initial = Object.freeze(createIntroGestureState());
  const first = reduceIntroGesture(initial, wheel());
  Object.freeze(first.state);
  Object.freeze(first.state.latch);
  assert.equal(reduceIntroGesture(first.state, wheel({ viewportHeight: 800, scroll: 1136, time: 1600 })).action.type, 'pass');
  assert.deepEqual(initial, createIntroGestureState());
  assert.equal(first.state.latch?.type, 'snap');
});

test('invalid geometry cannot produce a nonfinite target and zero events do not delay the latch', () => {
  for (const invalid of [{ deltaY: NaN }, { scroll: Infinity }, { viewportHeight: 0 }, { time: NaN }]) {
    assert.equal(reduceIntroGesture(createIntroGestureState(), wheel(invalid)).action.type, 'pass');
  }
  const first = reduceIntroGesture(createIntroGestureState(), wheel()).state;
  assert.equal(reduceIntroGesture(first, wheel({ deltaY: 0, time: 1100 })).state, first);
});
