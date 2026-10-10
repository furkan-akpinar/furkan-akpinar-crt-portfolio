import assert from 'node:assert/strict';
import test from 'node:test';
import * as browserThree from '../src/lib/three-browser.ts';
import * as gpuThree from 'three/webgpu';

test('browser compatibility exports share the scene renderer core instances', () => {
  for (const name of ['WebGPURenderer', 'Scene', 'Object3D', 'Mesh', 'Texture', 'Color', 'Vector3'] as const) {
    assert.equal(browserThree[name], gpuThree[name]);
  }
});

test('the browser entry retains the real WebGL2 backend without initializing a GPU', () => {
  const canvas = { width: 1, height: 1 } as HTMLCanvasElement;
  const renderer = new browserThree.WebGPURenderer({ canvas, forceWebGL: true });
  assert.equal((renderer.backend as { isWebGLBackend?: boolean }).isWebGLBackend, true);
  assert.equal(renderer.hasInitialized(), false);
});

test('accidental use of the classic default renderer fails with an actionable error', () => {
  assert.throws(() => new browserThree.WebGLRenderer(), /requires its custom WebGPURenderer factory/);
});
