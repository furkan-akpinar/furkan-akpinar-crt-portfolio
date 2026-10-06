import test from 'node:test';
import assert from 'node:assert/strict';
import { resizeScrollTarget } from '../src/components/scene/viewport-resize.ts';

test('mobile toolbar changes keep the film at the same story position', () => {
  const portrait = { width: 430, height: 932 };
  const toolbar = { width: 430, height: 820 };
  const position = 1.42;
  const resized = resizeScrollTarget(position * portrait.height, portrait, toolbar)!;
  assert.ok(Math.abs(resized / toolbar.height - position) < 1e-12);
  assert.ok(Math.abs(resizeScrollTarget(resized, toolbar, portrait)! / portrait.height - position) < 1e-12);
  assert.equal(resizeScrollTarget(5800, portrait, portrait), null);
});

test('orientation change preserves the current story position in both directions', () => {
  const portrait = { width: 430, height: 932 };
  const landscape = { width: 932, height: 430 };
  const forward = resizeScrollTarget(932 * 6, portrait, landscape);
  assert.equal(forward, 430 * 6);
  assert.equal(resizeScrollTarget(forward!, landscape, portrait), 932 * 6);
  assert.equal(resizeScrollTarget(0, portrait, landscape), 0);
});
