import assert from 'node:assert/strict';
import test from 'node:test';
import { paperScrollOffset } from '../src/components/scene/paper-action.ts';

test('About begins at the start of the sheet across all layouts without a hidden photo offset', () => {
  for (const height of [844, 900, 1024, 1080]) {
    assert.equal(paperScrollOffset(3000, height, 0), 0);
  }
});

test('the reading window reaches the bottom before curl and reverses without changing its endpoint', () => {
  for (const height of [900, 844, 1024]) {
    const paperHeight = 3000;
    const extent = paperHeight - height;
    for (const progress of [0, .25, .5, .75, 1, .75, .5, .25, 0]) {
      assert.equal(paperScrollOffset(paperHeight, height, progress), extent * progress);
    }
    assert.equal(paperScrollOffset(paperHeight, height, 1) + height, paperHeight);
  }
});

test('paper windows clamp out-of-range input and never scroll a short sheet beyond its texture', () => {
  assert.equal(paperScrollOffset(3000, 900, -1), 0);
  assert.equal(paperScrollOffset(3000, 900, 2), 2100);
  assert.equal(paperScrollOffset(3000, 900, NaN), 0);
  assert.equal(paperScrollOffset(3000, 900, .5), 1050);
  assert.equal(paperScrollOffset(600, 900, 1), 0);
});
