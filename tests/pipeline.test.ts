import assert from "node:assert/strict";
import test from "node:test";
import { scenes, getSceneState } from "../src/config/scenes.ts";
import { sceneScrollTop, SCROLL_SCREENS, heroTravel } from "../src/components/scene/runtime.ts";

function close(actual: number, expected: number, message: string) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: expected ${expected}, received ${actual}`);
}

test("menu destinations survive native integer scroll rounding at both viewports", () => {
  for (const height of [844,900]) {
    for (const scene of scenes) {
      const scroll=Math.round(sceneScrollTop(scene.id,height));
      assert.equal(getSceneState(scroll/(SCROLL_SCREENS*height)).scene.id,scene.id);
    }
  }
});

test("legacy office navigation resolves to the direct About destination", () => {
  assert.equal(sceneScrollTop('office', 900), sceneScrollTop('about-us', 900));
});

test("hero camera travel is bounded across overscroll, scene boundaries and invalid input", () => {
  const heroEnd = scenes[0].end;
  assert.equal(heroTravel(-0.2), 0);
  assert.equal(heroTravel(0), 0);
  close(heroTravel(heroEnd / 2), 0.5, "halfway through the hero span");
  assert.equal(heroTravel(heroEnd), 1);
  assert.equal(heroTravel(0.7), 1);
  assert.equal(heroTravel(2), 1);
  assert.equal(heroTravel(Number.NaN), 0);
  assert.equal(heroTravel(Number.POSITIVE_INFINITY), 0);
});
