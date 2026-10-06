import assert from "node:assert/strict";
import test from "node:test";
import { getSceneState, scenes, SCROLL_SCREENS, validateTimeline } from "../src/config/scenes.ts";
import { sceneScrollTop } from "../src/components/scene/runtime.ts";

test("first and last scroll positions remain reachable, including overscroll", () => {
  assert.equal(getSceneState(-0.1).scene.id, "hero");
  assert.equal(getSceneState(-0.1).localProgress, 0);
  assert.equal(getSceneState(1.2).scene.id, "contact");
  assert.equal(getSceneState(1.2).localProgress, 1);
});

test("a boundary belongs to the incoming scene and reverse scrolling returns to the prior scene", () => {
  for (let index = 1; index < scenes.length; index += 1) {
    const boundary = scenes[index].start;
    assert.equal(getSceneState(boundary).scene.id, scenes[index].id);
    assert.equal(getSceneState(boundary).localProgress, 0);
    assert.equal(getSceneState(boundary - 0.000001).scene.id, scenes[index - 1].id);
  }
});

test("invalid progress is safe, but a broken scene configuration is rejected", () => {
  assert.equal(getSceneState(Number.NaN).scene.id, "hero");
  assert.throws(() => validateTimeline([]));
  assert.throws(() => validateTimeline([{ ...scenes[0], end: 0.5 }, { ...scenes[1], start: 0.6, end: 1 }]));
});

test("local progress uses the configured scene span", () => {
  const scene = scenes[3];
  assert.ok(Math.abs(getSceneState((scene.start + scene.end) / 2).localProgress - 0.5) < 1e-10);
});

test("the four-section story ends in the blue Contact page without changing earlier viewport positions", () => {
  assert.deepEqual(scenes.map(scene => scene.id), ['hero', 'projects', 'about-us', 'contact']);
  assert.equal(getSceneState(3.8 / SCROLL_SCREENS).scene.id, 'projects');
  assert.equal(getSceneState(5.6 / SCROLL_SCREENS).scene.id, 'about-us');
  for (const [id, start] of [['hero', 0], ['projects', 1.4], ['about-us', 5.6], ['contact', 13.6]] as const) {
    const scene = scenes.find(scene => scene.id === id)!;
    assert.ok(Math.abs(scene.start * SCROLL_SCREENS - start) < 1e-10);
  }
  const contact = scenes.at(-1)!;
  assert.ok(Math.abs((contact.end - contact.start) * SCROLL_SCREENS - 1.5) < 1e-10);
  assert.equal(SCROLL_SCREENS, 15.1);
});

test("Contact menu and legacy blue/tie links land inside the same incoming Contact scene", () => {
  for (const height of [844, 900, 901, 1024, 1080]) {
    const top = sceneScrollTop('contact', height);
    assert.equal(top, Math.ceil(13.6 * height) + 2);
    assert.equal(getSceneState(top / (height * SCROLL_SCREENS)).scene.id, 'contact');
    assert.equal(sceneScrollTop('golden-tie-reveal', height), top);
    assert.equal(sceneScrollTop('golden-tie', height), top);
    assert.equal(sceneScrollTop('office', height), sceneScrollTop('about-us', height));
  }
});
