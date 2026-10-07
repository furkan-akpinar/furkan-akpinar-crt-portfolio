import test from 'node:test';
import assert from 'node:assert/strict';
import { resizeScrollTarget, storyViewport } from '../src/components/scene/viewport-resize.ts';
import { storyProgress } from '../src/components/scene/runtime.ts';
import { contactLayout } from '../src/components/scene/contact-layout.ts';

test('touch toolbar cycles do not remap scroll or change any scene progress', () => {
  for (const width of [430, 956]) {
    const initial = { width, height: 820 };
    let previous = initial;
    for (const height of [844, 890, 932, 890, 820, 932, 820]) {
      const next = storyViewport(previous, { width, height }, true);
      for (const scroll of [1.42, 4.7, 7.5, 12.5, 13.6].map(vh => vh * initial.height)) {
        assert.equal(resizeScrollTarget(scroll, previous, next), null);
        assert.equal(storyProgress(scroll, next.height), storyProgress(scroll, initial.height));
      }
      previous = next;
    }
  }
});

test('orientation change preserves the current story position in both directions', () => {
  const portrait = { width: 430, height: 932 };
  const landscape = { width: 932, height: 430 };
  assert.deepEqual(storyViewport(portrait, landscape, true), landscape);
  assert.deepEqual(storyViewport(landscape, portrait, true), portrait);
  const forward = resizeScrollTarget(932 * 6, portrait, landscape);
  assert.equal(forward, 430 * 6);
  assert.equal(resizeScrollTarget(forward!, landscape, portrait), 932 * 6);
  assert.equal(resizeScrollTarget(0, portrait, landscape), 0);
});

test('desktop height-only resize still remaps the same story pose', () => {
  const previous = { width: 1440, height: 900 };
  const next = storyViewport(previous, { width: 1440, height: 700 }, false);
  assert.equal(resizeScrollTarget(900 * 7.5, previous, next), 700 * 7.5);
});

test('contact offset uses story distance while its layout fits the visible height', () => {
  const storyHeight = 820;
  const physicalTravel = contactLayout(440, storyHeight).travel;
  for (const visibleHeight of [820, 860, 932]) {
    const localProgress = 20 / (1.5 * storyHeight);
    const layout = contactLayout(440, visibleHeight, localProgress, storyHeight);
    assert.equal(layout.offset, Math.min(layout.travel, 20));
    // A visible-height spacer makes the maximum scroll independent of chrome.
    const documentHeight = 13.6 * storyHeight + physicalTravel + visibleHeight;
    assert.ok(Math.abs(documentHeight - visibleHeight - (13.6 * storyHeight + physicalTravel)) < 1e-8);
  }
});
