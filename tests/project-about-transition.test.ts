import assert from 'node:assert/strict';
import test from 'node:test';
import { createIntroGestureState, reduceIntroGesture, type IntroGestureInput } from '../src/components/scene/intro-gesture.ts';
import { PROJECT_ABOUT_START_VH, PROJECT_ABOUT_END_VH, PROJECT_ABOUT_STEPS, sampleProjectAbout, projectAboutWheelSteps } from '../src/components/scene/project-about-transition.ts';
import { getSceneState } from '../src/config/scenes.ts';
import { SCROLL_SCREENS, sceneScrollTop } from '../src/components/scene/runtime.ts';

const input = (overrides: Partial<IntroGestureInput> = {}): IntroGestureInput => ({
  deltaX: 0, deltaY: 100, wheelSteps: 1, time: 0, scroll: 1420,
  viewportHeight: 1000, ready: true, menuOpen: false, ...overrides,
});

test('the aperture samples absolute scroll identically in either direction and has clean endpoints', () => {
  const positions = Array.from({ length: 81 }, (_, i) => (PROJECT_ABOUT_START_VH + i / 80 * (PROJECT_ABOUT_END_VH - PROJECT_ABOUT_START_VH)) / SCROLL_SCREENS);
  const forward = positions.map(sampleProjectAbout);
  assert.deepEqual(positions.toReversed().map(sampleProjectAbout).toReversed(), forward);
  assert.equal(forward[0], 0);
  assert.equal(forward.at(-1), 1);
  for (let i = 1; i < forward.length; i++) assert.ok(forward[i] >= forward[i - 1]);
  for (const value of [NaN, -Infinity, Infinity, -1, 0]) assert.equal(sampleProjectAbout(value), 0);
  assert.equal(sampleProjectAbout(1), 1);
});

test('seven settled wheel detents open About and seven reverse detents restore the film at each viewport', () => {
  assert.equal(PROJECT_ABOUT_STEPS, 7);
  for (const height of [844, 900, 901, 999, 1024, 1074, 1080, 1600]) {
    let state = createIntroGestureState();
    let scroll = sceneScrollTop('projects', height);
    let time = 0;
    for (const direction of [1, -1]) {
      for (let step = 1; step <= PROJECT_ABOUT_STEPS; step++) {
        const result = reduceIntroGesture(state, input({ scroll, viewportHeight: height, time, deltaY: direction * 100, wheelSteps: direction }));
        state = result.state;
        assert.equal(result.action.type, 'aperture');
        if (result.action.type !== 'aperture') throw new Error('Expected aperture target');
        scroll = result.action.top;
        const expected = direction === 1 ? step / PROJECT_ABOUT_STEPS : 1 - step / PROJECT_ABOUT_STEPS;
        assert.ok(Math.abs(sampleProjectAbout(scroll / (height * SCROLL_SCREENS)) - expected) < .0004);
        if (direction === 1 && step === PROJECT_ABOUT_STEPS) {
          assert.equal(scroll, Math.ceil(PROJECT_ABOUT_END_VH * height) + 2);
          assert.equal(getSceneState(scroll / (height * SCROLL_SCREENS)).scene.id, 'about-us');
          assert.equal(getSceneState(scroll / (height * SCROLL_SCREENS + 1)).scene.id, 'about-us', 'the incoming scene remains selected when the native document adds one rounded pixel');
          assert.equal(sampleProjectAbout(scroll / (height * SCROLL_SCREENS + 1)), 1);
        }
        time += 900;
      }
    }
    assert.equal(sampleProjectAbout(scroll / (height * SCROLL_SCREENS)), 0);
    assert.equal(reduceIntroGesture(state, input({ scroll, viewportHeight: height, time, deltaY: -100, wheelSteps: -1 })).action.type, 'snap');
  }
});

test('a hero snap rounded upward still has resting film controls and can return to the hero', () => {
  for (const height of [901, 999, 1080, 1600]) {
    const scroll = Math.round(PROJECT_ABOUT_START_VH * height);
    assert.equal(sampleProjectAbout(scroll / (height * SCROLL_SCREENS)), 0);
    assert.equal(reduceIntroGesture(createIntroGestureState(), input({ scroll, viewportHeight: height, deltaX: 100, deltaY: 0, wheelSteps: 0 })).action.type, 'gallery');
    assert.equal(reduceIntroGesture(createIntroGestureState(), input({ scroll, viewportHeight: height, deltaY: -100, wheelSteps: -1 })).action.type, 'snap');
    assert.equal(reduceIntroGesture(createIntroGestureState(), input({ scroll, viewportHeight: height })).action.type, 'aperture');
    assert.ok(sampleProjectAbout((PROJECT_ABOUT_START_VH + .003) / SCROLL_SCREENS) > 0, 'the deadband does not swallow actual transition progress');
  }
});

test('a reverse notch during expansion cancels the scheduled forward queue rather than snapping to the hero', () => {
  const first = reduceIntroGesture(createIntroGestureState(), input());
  const second = reduceIntroGesture(first.state, input({ scroll: 1600, time: 80 }));
  assert.equal(second.action.type, 'aperture');
  if (second.action.type !== 'aperture') throw new Error('Expected aperture target');
  assert.equal(second.action.top, 2614);
  const reverse = reduceIntroGesture(second.state, input({ scroll: 1800, time: 140, deltaY: -100, wheelSteps: -1 }));
  assert.equal(reverse.action.type, 'aperture');
  if (reverse.action.type !== 'aperture') throw new Error('Expected aperture target');
  assert.equal(reverse.action.top, 1420);
  assert.ok(reverse.action.top < 1800, 'direction changes immediately from the currently visible phase');
});

test('About menu rounding still permits the first reverse notch; positive scrolling continues into the page', () => {
  for (const height of [844, 900, 1074]) {
    const scroll = sceneScrollTop('about-us', height);
    const reverse = reduceIntroGesture(createIntroGestureState(), input({ scroll, viewportHeight: height, deltaY: -100, wheelSteps: -1 }));
    assert.equal(reverse.action.type, 'aperture');
    if (reverse.action.type !== 'aperture') throw new Error('Expected aperture target');
    assert.ok(Math.abs(sampleProjectAbout(reverse.action.top / (height * SCROLL_SCREENS)) - 6 / 7) < .0004);
    assert.equal(reduceIntroGesture(createIntroGestureState(), input({ scroll, viewportHeight: height })).action.type, 'pass');
  }
});

test('reversing before the first animation frame cancels at either endpoint without leaving the aperture', () => {
  for (const scroll of [1420, 1421]) {
    const first = reduceIntroGesture(createIntroGestureState(), input({ scroll }));
    const reverse = reduceIntroGesture(first.state, input({ scroll, time: 20, deltaY: -100, wheelSteps: -1 }));
    assert.deepEqual(reverse.action, { type: 'aperture', top: 1420, duration: .72 });
    assert.equal(reduceIntroGesture(reverse.state, input({ scroll: 1420, time: 900, deltaY: -100, wheelSteps: -1 })).action.type, 'snap');
  }
  const first = reduceIntroGesture(createIntroGestureState(), input({ scroll: 5602, deltaY: -100, wheelSteps: -1 }));
  const reverse = reduceIntroGesture(first.state, input({ scroll: 5602, time: 20 }));
  assert.deepEqual(reverse.action, { type: 'aperture', top: 5602, duration: .72 });
  assert.equal(reduceIntroGesture(reverse.state, input({ scroll: 5602, time: 900 })).action.type, 'pass');
});

test('seven rapid wheel events accumulate all seven targets before the viewport moves', () => {
  let state = createIntroGestureState();
  for (let event = 1; event <= 7; event++) {
    const result = reduceIntroGesture(state, input({ time: event * 20 }));
    assert.equal(result.action.type, 'aperture');
    if (result.action.type !== 'aperture') throw new Error('Expected aperture target');
    assert.ok(Math.abs(sampleProjectAbout(result.action.top / (1000 * SCROLL_SCREENS)) - event / 7) < .0004);
    state = result.state;
  }
});

test('fine wheel, diagonal trackpad and touch input retain continuous section scroll', () => {
  for (const values of [{ deltaY: 4.75, deltaX: 0 }, { deltaY: 100, deltaX: 5 }, { deltaY: 17.5, deltaX: 0 }]) {
    const wheelSteps = projectAboutWheelSteps(values.deltaX, values.deltaY);
    assert.equal(wheelSteps, 0);
    assert.equal(reduceIntroGesture(createIntroGestureState(), input({ ...values, wheelSteps, scroll: 2000 })).action.type, 'pass');
  }
  assert.equal(reduceIntroGesture(createIntroGestureState(), input({ wheelSteps: 0, scroll: 2000, deltaY: -40 })).action.type, 'pass');
  assert.equal(reduceIntroGesture(createIntroGestureState(), input({ wheelSteps: 0, scroll: 2000, deltaX: 100, deltaY: 0 })).action.type, 'pass');
  assert.equal(projectAboutWheelSteps(0, 100), 1);
  assert.equal(projectAboutWheelSteps(0, -120), -1);
  assert.equal(projectAboutWheelSteps(0, 240), 1);
  assert.equal(projectAboutWheelSteps(0, 3, 1), 1);
  assert.equal(projectAboutWheelSteps(0, -1, 2), -1);
  assert.equal(projectAboutWheelSteps(0, NaN), 0);
});

test('mouse distance, zoom fractions and small legacy detents all complete in seven events', () => {
  for (const [delta,mode,legacy] of [[24,0],[40,0],[53,0],[100,0],[120,0],[125,0],[208.333333,0],[240,0],[360,0],[12,0,-120],[3,1],[1,2]]) {
    let state=createIntroGestureState(), scroll=1420, time=0;
    for (const direction of [1,-1]) {
      for (let event=0;event<7;event++) {
        const wheelSteps=projectAboutWheelSteps(0,delta*direction,mode,legacy===undefined?undefined:legacy*direction);
        assert.equal(wheelSteps,direction,`raw delta ${delta}, mode ${mode}`);
        time+=900;
        const result=reduceIntroGesture(state,input({scroll,deltaY:delta*direction,wheelSteps,time}));
        assert.equal(result.action.type,'aperture');
        if(result.action.type!=='aperture')throw new Error('Expected one aperture step');
        state=result.state;scroll=result.action.top;
      }
      assert.equal(sampleProjectAbout(scroll/(1000*SCROLL_SCREENS)),direction===1?1:0);
    }
  }
});

test('gallery interaction is limited to the resting film, and navigation can clear an aperture target', () => {
  assert.equal(reduceIntroGesture(createIntroGestureState(), input({ deltaX: 100, deltaY: 0, wheelSteps: 0 })).action.type, 'gallery');
  assert.equal(reduceIntroGesture(createIntroGestureState(), input({ deltaX: 100, deltaY: 0, wheelSteps: 0, scroll: 1943 })).action.type, 'pass');
  const started = reduceIntroGesture(createIntroGestureState(), input()).state;
  assert.notEqual(started.apertureTargetVh, null);
  assert.deepEqual(reduceIntroGesture(started, input({ menuOpen: true })).state, createIntroGestureState());
});
