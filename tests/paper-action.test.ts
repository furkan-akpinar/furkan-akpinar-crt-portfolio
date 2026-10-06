import assert from 'node:assert/strict';
import test from 'node:test';
import { paperEntryOffset, paperScrollOffset } from '../src/components/scene/paper-action.ts';

test('About begins at the start of the sheet across all layouts without a hidden photo offset', () => {
  for (const width of [0, 390, 768, 899, 900, 1440, 1920, NaN]) {
    assert.equal(paperEntryOffset(width), 0);
  }
});

test('the reading window reaches the bottom before curl and reverses without changing its endpoint', () => {
  for (const [width, height] of [[1440, 900], [390, 844], [768, 1024]]) {
    const entry = paperEntryOffset(width);
    const paperHeight = 3000;
    const extent = paperHeight - height;
    for (const progress of [0, .25, .5, .75, 1, .75, .5, .25, 0]) {
      assert.equal(paperScrollOffset(paperHeight, height, progress, entry), extent * progress);
    }
    assert.equal(paperScrollOffset(paperHeight, height, 1, entry) + height, paperHeight);
  }
});

test('paper windows clamp out-of-range input and never scroll a short sheet beyond its texture', () => {
  assert.equal(paperScrollOffset(3000, 900, -1), 0);
  assert.equal(paperScrollOffset(3000, 900, 2), 2100);
  assert.equal(paperScrollOffset(3000, 900, NaN), 0);
  assert.equal(paperScrollOffset(3000, 900, .5, NaN), 1050);
  assert.equal(paperScrollOffset(600, 900, 1, 616), 0);
  assert.equal(paperScrollOffset(3000, 900, .5, 2500), 2100);
});
