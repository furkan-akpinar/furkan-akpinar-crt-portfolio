import test from 'node:test';
import assert from 'node:assert/strict';
import { createResourceScope } from '../src/components/scene/resource-scope.ts';

test('partially constructed scenes release resources in reverse dependency order once', () => {
  const scope = createResourceScope(), order: string[] = [];
  scope.own({ dispose: () => order.push('texture') });
  scope.own({ dispose: () => order.push('material') });
  scope.own({ dispose: () => order.push('scene') });
  scope.dispose();
  scope.dispose();
  assert.deepEqual(order, ['scene', 'material', 'texture']);
});

test('late resources are released immediately after the scope closes', () => {
  const scope = createResourceScope();
  let released = 0;
  scope.dispose();
  scope.own({ dispose: () => released++ });
  assert.equal(released, 1);
});
