import assert from 'node:assert/strict';
import test from 'node:test';
import { ABOUT_CURL_START, ABOUT_CURL_START_VH, ABOUT_CURL_END_VH, ABOUT_CURL_STEPS, ABOUT_CURL_DURATION, nextCurlTargetVh, sampleCurlProgress } from '../src/lib/about-curl.ts';
import { createIntroGestureState, reduceIntroGesture, type IntroGestureInput } from '../src/components/scene/intro-gesture.ts';
import { projectAboutWheelSteps } from '../src/components/scene/project-about-transition.ts';

const input = (overrides: Partial<IntroGestureInput> = {}): IntroGestureInput => ({
  deltaX: 0, deltaY: 100, wheelSteps: 1, time: 0, scroll: ABOUT_CURL_START_VH * 1000,
  viewportHeight: 1000, ready: true, menuOpen: false, ...overrides,
});
const progressAt = (scroll: number, height: number) => sampleCurlProgress((scroll / height - 5.6) / 8);

test('the curl samples the same intact-sheet pose in either direction and has exact endpoints', () => {
  const samples = Array.from({ length: 101 }, (_, i) => ABOUT_CURL_START + i / 100 * (1 - ABOUT_CURL_START));
  const forward = samples.map(sampleCurlProgress);
  assert.deepEqual(samples.toReversed().map(sampleCurlProgress).toReversed(), forward);
  assert.equal(forward[0], 0);
  assert.equal(forward.at(-1), 1);
  for (let i = 1; i < forward.length; i++) assert.ok(forward[i] > forward[i - 1]);
  for (const value of [NaN, Infinity, -Infinity, -1, 0, .71]) assert.equal(sampleCurlProgress(value), 0);
  assert.equal(sampleCurlProgress(2), 1);
});

test('17 settled wheel events peel the sheet and 17 reverse events restore it at every viewport', () => {
  assert.equal(ABOUT_CURL_STEPS, 17, 'visible advances approximated from the supplied video, not wheel telemetry');
  for (const height of [844, 900, 901, 999, 1024, 1074, 1080, 1600]) {
    let state = createIntroGestureState();
    let scroll = Math.floor(ABOUT_CURL_START_VH * height);
    let time = 0;
    for (const direction of [1, -1]) {
      for (let step = 1; step <= ABOUT_CURL_STEPS; step++) {
        const result = reduceIntroGesture(state, input({ scroll, viewportHeight: height, time, deltaY: direction * 100, wheelSteps: direction }));
        assert.equal(result.action.type, 'curl');
        if (result.action.type !== 'curl') throw new Error('Expected curl target');
        assert.equal(result.action.duration, ABOUT_CURL_DURATION);
        scroll = result.action.top;
        state = result.state;
        const expected = direction > 0 ? step / ABOUT_CURL_STEPS : 1 - step / ABOUT_CURL_STEPS;
        assert.ok(Math.abs(progressAt(scroll, height) - expected) < .0004);
        time += 900;
      }
      assert.equal(progressAt(scroll, height), direction > 0 ? 1 : 0);
    }
    const result = reduceIntroGesture(state, input({ scroll, viewportHeight: height, time, deltaY: -100, wheelSteps: -1 }));
    assert.equal(result.action.type, 'pass', 'fresh reverse scroll resumes reading About');
  }
});

test('rapid detents accumulate targets within the curl, and excess input cannot overshoot the destination', () => {
  let state = createIntroGestureState();
  for (let event = 1; event <= 22; event++) {
    const result = reduceIntroGesture(state, input({ time: event * 20 }));
    assert.equal(result.action.type, 'curl');
    if (result.action.type !== 'curl') throw new Error('Expected curl target');
    assert.ok(Math.abs(progressAt(result.action.top, 1000) - Math.min(event / ABOUT_CURL_STEPS, 1)) < .0004);
    assert.ok(result.action.top <= Math.ceil(ABOUT_CURL_END_VH * 1000) + 2);
    state = result.state;
  }
  assert.equal(reduceIntroGesture(state, input({ scroll: 13602, time: 1500 })).action.type, 'pass');
});

test('a large coarse event cannot skip the curl when entering from either neighboring section', () => {
  for (const values of [{ scroll: 11250, deltaY: 3000, wheelSteps: 1, expected: 1 / ABOUT_CURL_STEPS },
    { scroll: 13700, deltaY: -3000, wheelSteps: -1, expected: 1 - 1 / ABOUT_CURL_STEPS }]) {
    const result = reduceIntroGesture(createIntroGestureState(), input(values));
    assert.equal(result.action.type, 'curl');
    if (result.action.type !== 'curl') throw new Error('Expected curl target');
    assert.ok(Math.abs(progressAt(result.action.top, 1000) - values.expected) < .0004);
    assert.equal(reduceIntroGesture(createIntroGestureState(), input({ ...values, wheelSteps: 0 })).action.type, 'pass');
  }
});

test('a reversal drops queued targets and travels backward from the visible pose', () => {
  let state = createIntroGestureState();
  for (let event = 0; event < 9; event++) state = reduceIntroGesture(state, input({ time: event * 20 })).state;
  const visible = ABOUT_CURL_START_VH + (ABOUT_CURL_END_VH - ABOUT_CURL_START_VH) * .2;
  const reverse = reduceIntroGesture(state, input({ scroll: visible * 1000, time: 200, deltaY: -100, wheelSteps: -1 }));
  assert.equal(reverse.action.type, 'curl');
  if (reverse.action.type !== 'curl') throw new Error('Expected curl target');
  assert.ok(reverse.action.top < visible * 1000);
  assert.ok(Math.abs(progressAt(reverse.action.top, 1000) - 3 / ABOUT_CURL_STEPS) < .0004);
});

test('a stale wheel target cannot undo later keyboard or scrollbar movement', () => {
  const started = reduceIntroGesture(createIntroGestureState(), input()).state;
  for (const [scroll, time] of [[12500, 100], [11500, 1000]]) {
    const result = reduceIntroGesture(started, input({ scroll, time }));
    assert.equal(result.action.type, 'curl');
    if (result.action.type !== 'curl') throw new Error('Expected curl target');
    assert.ok(result.action.top > scroll);
    assert.ok(result.action.top - scroll <= (ABOUT_CURL_END_VH - ABOUT_CURL_START_VH) * 1000 / ABOUT_CURL_STEPS + 1);
  }
});

test('reversals before the first frame cancel at either endpoint without crossing a scene', () => {
  const forward = reduceIntroGesture(createIntroGestureState(), input());
  const reverse = reduceIntroGesture(forward.state, input({ time: 20, deltaY: -100, wheelSteps: -1 }));
  assert.deepEqual(reverse.action, { type: 'curl', top: 11360, duration: ABOUT_CURL_DURATION });
  assert.equal(reduceIntroGesture(reverse.state, input({ time: 900, deltaY: -100, wheelSteps: -1 })).action.type, 'pass');
  const backward = reduceIntroGesture(createIntroGestureState(), input({ scroll: 13602, deltaY: -100, wheelSteps: -1 }));
  const cancel = reduceIntroGesture(backward.state, input({ scroll: 13602, time: 20 }));
  assert.deepEqual(cancel.action, { type: 'curl', top: 13602, duration: ABOUT_CURL_DURATION });
  assert.equal(reduceIntroGesture(cancel.state, input({ scroll: 13602, time: 900 })).action.type, 'pass');
});

test('fine trackpad and touch input share the continuous scroll route and clear an old target', () => {
  const started = reduceIntroGesture(createIntroGestureState(), input()).state;
  for (const values of [{ deltaY: 4.75, deltaX: 0 }, { deltaY: 100, deltaX: 5 }, { deltaY: 17.5, deltaX: 0 }]) {
    const wheelSteps = projectAboutWheelSteps(values.deltaX, values.deltaY);
    assert.equal(wheelSteps, 0);
    const result = reduceIntroGesture(started, input({ ...values, wheelSteps, scroll: 12000, time: 20 }));
    assert.equal(result.action.type, 'pass');
    assert.equal(result.state.curlTargetVh, null);
  }
  assert.equal(reduceIntroGesture(started, input({ wheelSteps: 0, scroll: 12000, deltaY: -40 })).action.type, 'pass');
});

test('wheel distance does not alter the number of visible advances; menu and navigation reset pending targets', () => {
  for (const [delta, mode, legacy] of [[24, 0], [53, 0], [100, 0], [208.333333, 0], [360, 0], [12, 0, -120], [3, 1], [1, 2]]) {
    const wheelSteps = projectAboutWheelSteps(0, delta, mode, legacy);
    const result = reduceIntroGesture(createIntroGestureState(), input({ deltaY: delta, wheelSteps }));
    assert.equal(result.action.type, 'curl');
    if (result.action.type !== 'curl') throw new Error('Expected curl target');
    assert.ok(Math.abs(progressAt(result.action.top, 1000) - 1 / ABOUT_CURL_STEPS) < .0004);
    assert.deepEqual(reduceIntroGesture(result.state, input({ menuOpen: true })).state, createIntroGestureState());
  }
  assert.ok(Number.isFinite(nextCurlTargetVh(NaN, 1)));
});
