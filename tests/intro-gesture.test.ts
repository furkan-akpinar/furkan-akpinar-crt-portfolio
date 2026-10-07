import assert from 'node:assert/strict';
import test from 'node:test';
import { createIntroGestureState, reduceIntroGesture, type IntroGestureInput } from '../src/components/scene/intro-gesture.ts';
import { PROJECT_ABOUT_TOUCH_DISTANCE_VH, PROJECT_ABOUT_TOUCH_DURATION } from '../src/components/scene/project-about-transition.ts';

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


test('a fresh mobile upward swipe plays the full reveal at every viewport and partial position', () => {
  for (const height of [440, 568, 820, 844, 956, 1024, 843.5]) {
    const end = Math.ceil(5.6 * height) + 2;
    for (const scroll of [Math.ceil(1.4 * height), Math.floor(1.42 * height), 3 * height, end - .25]) {
      const result = reduceIntroGesture(createIntroGestureState(), wheel({ touch: true, scroll, viewportHeight: height, deltaY: 12 }));
      assert.deepEqual(result.action, { type: 'snap', top: end, duration: PROJECT_ABOUT_TOUCH_DURATION });
      assert.equal(result.state.latch?.type, 'snap');
      if (result.state.latch?.type !== 'snap') continue;
      assert.equal(result.state.latch.durationMs, 2000);
      assert.ok(Math.abs(result.state.latch.targetVh * height - end) < 1e-8);
      assert.equal(result.state.scrubbingAperture, false);
    }
    assert.equal(reduceIntroGesture(createIntroGestureState(), wheel({ touch: true, scroll: end, viewportHeight: height })).action.type, 'pass');
  }
});

test('the mobile reveal requires twelve pixels in one vertical gesture and ignores separated jitters', () => {
  let state = createIntroGestureState();
  for (const [index, deltaY] of [3, 4, 4, 1].entries()) {
    const result = reduceIntroGesture(state, wheel({ touch: true, scroll: 1420, deltaY, time: index * 20 }));
    assert.equal(result.action.type, index === 3 ? 'snap' : 'block');
    state = result.state;
  }
  for (const separator of [{ deltaY: -1 }, { deltaX: 6, deltaY: 1 }, { deltaY: 1, time: 300 }]) {
    const initial = reduceIntroGesture(createIntroGestureState(), wheel({ touch: true, scroll: 1420, deltaY: 6 })).state;
    const separated = reduceIntroGesture(initial, wheel({ touch: true, scroll: 1420, time: 20, ...separator })).state;
    assert.equal(reduceIntroGesture(separated, wheel({ touch: true, scroll: 1420, deltaY: 6, time: (separator.time ?? 20) + 20 })).action.type, 'block');
  }
  state = createIntroGestureState();
  for (const time of [0, 300, 600, 900]) {
    const result = reduceIntroGesture(state, wheel({ touch: true, scroll: 1420, deltaY: 4, time }));
    assert.equal(result.action.type, 'block');
    state = result.state;
  }
});

test('the mobile automatic journey remains latched after release until duration, settlement and quiet all hold', () => {
  const first = reduceIntroGesture(createIntroGestureState(), wheel({ touch: true, scroll: 1420, time: 100 }));
  assert.deepEqual(first.action, { type: 'snap', top: 5602, duration: 2 });
  const idle = reduceIntroGesture(first.state, wheel({ touch: true, scroll: 3000, deltaY: 0, time: 800 }));
  assert.equal(idle.state, first.state, 'lifting the finger supplies no further distance and must not cancel the scheduled endpoint');
  assert.equal(reduceIntroGesture(first.state, wheel({ touch: true, scroll: 5602, time: 2099 })).action.type, 'block', 'the old 1.5-second latch must not unlock this two-second journey');
  assert.equal(reduceIntroGesture(first.state, wheel({ touch: true, scroll: 5602, time: 2100 })).action.type, 'pass', 'exactly two seconds is sufficient when already settled and quiet');
  const unfinished = reduceIntroGesture(first.state, wheel({ touch: true, scroll: 4000, time: 2200 }));
  assert.equal(unfinished.action.type, 'block', 'elapsed and quiet do not unlock an unfinished reveal');
  const arriving = reduceIntroGesture(unfinished.state, wheel({ touch: true, scroll: 5602, time: 2300 }));
  assert.equal(arriving.action.type, 'block', 'settlement must not release a continuing input tail');
  const fresh = reduceIntroGesture(arriving.state, wheel({ touch: true, scroll: 5602, time: 2500 }));
  assert.equal(fresh.action.type, 'pass');
  assert.equal(fresh.state.latch, null);
});

test('a continuing touch burst never replays or interrupts the scheduled mobile reveal', () => {
  let state = createIntroGestureState();
  const actions: string[] = [];
  for (let index = 0; index <= 44; index++) {
    const result = reduceIntroGesture(state, wheel({
      touch: true, scroll: index >= 40 ? 5602 : 1420 + index * 100,
      deltaY: index === 0 ? 12 : index % 2 === 0 ? -30 : 30, time: index * 50,
    }));
    state = result.state;
    actions.push(result.action.type);
  }
  assert.equal(actions.filter(action => action === 'snap').length, 1);
  assert.ok(actions.slice(1).every(action => action === 'block'));
  assert.equal(reduceIntroGesture(state, wheel({ touch: true, scroll: 5602, time: 2400 })).action.type, 'pass');
});

test('a held reverse mobile drag can retrace manually with the original distance gain at every viewport', () => {
  for (const height of [440, 820, 844, 956, 843.5]) {
    const start = Math.floor(1.42 * height), end = Math.ceil(5.6 * height) + 2;
    const gain = (end - start) / (PROJECT_ABOUT_TOUCH_DISTANCE_VH * height);
    for (const origin of [end, start + (end - start) * .7]) {
      const backward = reduceIntroGesture(createIntroGestureState(), wheel({ touch: true, scroll: origin, viewportHeight: height, deltaY: -40 }));
      assert.equal(backward.action.type, 'scrub');
      if (backward.action.type !== 'scrub') continue;
      assert.ok(Math.abs(origin - backward.action.top - 40 * gain) < 1e-8);
      const forward = reduceIntroGesture(backward.state, wheel({ touch: true, scroll: backward.action.top, viewportHeight: height, deltaY: 40, time: 2000 }));
      assert.equal(forward.action.type, 'scrub');
      if (forward.action.type !== 'scrub') continue;
      assert.ok(Math.abs(forward.action.top - origin) < 1e-8);
      assert.equal(forward.state.latch, null, 'an already owned reverse drag never queues automatic completion');
    }
  }
});

test('a full reverse mobile drag is bounded to the aperture and can turn before release', () => {
  const start = 1420, end = 5602;
  const fullDrag = 1000 * PROJECT_ABOUT_TOUCH_DISTANCE_VH;
  for (const scroll of [end, 3000, 4700]) {
    const reverse = reduceIntroGesture(createIntroGestureState(), wheel({ touch: true, scroll, deltaY: -fullDrag }));
    assert.deepEqual(reverse.action, { type: 'scrub', top: start });
    const held = reduceIntroGesture(reverse.state, wheel({ touch: true, scroll: start, deltaY: -100 }));
    assert.deepEqual(held.action, { type: 'scrub', top: start }, 'same finger must not escape to Hero');
    const turn = reduceIntroGesture(held.state, wheel({ touch: true, scroll: start, deltaY: 20 }));
    assert.equal(turn.action.type, 'scrub');
    assert.ok(turn.action.type === 'scrub' && turn.action.top > start);
  }
  assert.deepEqual(reduceIntroGesture(createIntroGestureState(), wheel({ touch: true, scroll: start, deltaY: -100 })).action,
    { type: 'snap', top: 0, duration: 1.5 }, 'a fresh reverse gesture at the resting film still returns to Hero');
});

test('a short reverse drag holds partially and a fresh upward gesture automatically completes the reveal', () => {
  const first = reduceIntroGesture(createIntroGestureState(), wheel({ touch: true, scroll: 5602, deltaY: -60 }));
  assert.ok(first.action.type === 'scrub' && first.action.top > 1420 && first.action.top < 5602);
  if (first.action.type !== 'scrub') return;
  const idle = reduceIntroGesture(first.state, wheel({ touch: true, scroll: first.action.top, deltaY: 0, time: 1000 }));
  assert.equal(idle.state, first.state);
  assert.equal(idle.state.latch, null);
  const resumed = reduceIntroGesture(createIntroGestureState(), wheel({ touch: true, scroll: first.action.top, deltaY: 60, time: 3000 }));
  assert.deepEqual(resumed.action, { type: 'snap', top: 5602, duration: 2 });
});

test('entering the aperture from About accelerates only the distance inside its boundary', () => {
  const fullDrag = 1000 * PROJECT_ABOUT_TOUCH_DISTANCE_VH;
  assert.equal(reduceIntroGesture(createIntroGestureState(), wheel({ touch: true, scroll: 5802, deltaY: -100 })).action.type, 'pass');
  const crossed = reduceIntroGesture(createIntroGestureState(), wheel({ touch: true, scroll: 5802, deltaY: -260 }));
  assert.deepEqual(crossed.action, { type: 'scrub', top: 5602 - 60 * (5602 - 1420) / fullDrag });
  const menu = reduceIntroGesture(createIntroGestureState(), wheel({ touch: true, scroll: 5602, deltaY: -60 }));
  assert.deepEqual(menu.action, crossed.action);
});

test('touch scrub preserves Hero, About reading, horizontal gallery and desktop input', () => {
  assert.deepEqual(reduceIntroGesture(createIntroGestureState(), wheel({ touch: true })).action,
    { type: 'snap', top: 1420, duration: 1.5 });
  for (const values of [{ scroll: 5602 }, { scroll: 7500 }, { scroll: 7500, deltaY: -100 }]) {
    assert.equal(reduceIntroGesture(createIntroGestureState(), wheel({ touch: true, ...values })).action.type, 'pass');
  }
  assert.deepEqual(reduceIntroGesture(createIntroGestureState(), wheel({ touch: true, scroll: 1420, deltaX: 100, deltaY: 1 })).action,
    { type: 'gallery', direction: 1 });
  for (const deltaY of [-100, 100]) {
    assert.equal(reduceIntroGesture(createIntroGestureState(), wheel({ scroll: 3000, deltaY })).action.type, 'pass');
    assert.equal(reduceIntroGesture(createIntroGestureState(), wheel({ scroll: 3000, deltaY, wheelSteps: Math.sign(deltaY) })).action.type, 'aperture');
  }
});
