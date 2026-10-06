import assert from 'node:assert/strict';
import test from 'node:test';
import { getSceneState, SCROLL_SCREENS } from '../src/config/scenes.ts';
import { sceneScrollTop, storyProgress } from '../src/components/scene/runtime.ts';
import { contactLayout } from '../src/components/scene/contact-layout.ts';

test('shortening Contact does not compress any earlier scene or transition boundary', () => {
  for (const height of [700, 844, 900, 1024]) {
    for (const [id, start, previous] of [
      ['projects', 1.4, 'hero'],
      ['about-us', 5.6, 'projects'],
      ['contact', 13.6, 'about-us'],
    ] as const) {
      assert.equal(getSceneState(storyProgress(start * height - 1, height)).scene.id, previous);
      const destination = sceneScrollTop(id, height);
      assert.equal(getSceneState(storyProgress(destination, height)).scene.id, id);
      assert.ok(Math.abs(storyProgress(destination, height) * SCROLL_SCREENS * height - destination) < 1e-8);
    }
  }
});

test('Contact navigation fits its compact native range and the final content remains reachable', () => {
  for (const [width, height] of [[1440, 900], [768, 1024], [390, 844], [390, 700]]) {
    const { travel } = contactLayout(width, height);
    const physicalEnd = 13.6 * height + Math.ceil(travel) + 3;
    const destination = sceneScrollTop('contact', height);
    assert.ok(destination <= physicalEnd, `${width}×${height}: Contact menu destination is reachable`);
    const state = getSceneState(storyProgress(physicalEnd, height));
    assert.equal(state.scene.id, 'contact');
    assert.equal(contactLayout(width, height, state.localProgress).offset, travel);
    if (width >= 768) assert.equal(travel, 0, 'the full composition fits the desktop/tablet viewport');
  }
});

test('absolute story progress safely clamps overscroll and invalid viewport measurements', () => {
  assert.equal(storyProgress(-100, 900), 0);
  assert.equal(storyProgress(100000, 900), 1);
  assert.equal(storyProgress(Number.NaN, 900), 0);
  assert.equal(storyProgress(1000, 0), 0);
  assert.equal(storyProgress(1000, Number.NaN), 0);
});
