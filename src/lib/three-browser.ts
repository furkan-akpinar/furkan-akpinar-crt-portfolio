// Use the same Three core instances as the scene renderer and its loaders.
// WebGPURenderer includes both WebGPUBackend and the WebGL2 fallback backend.
export * from 'three/webgpu';

/**
 * Fiber imports the classic renderer for roots without a custom gl factory.
 * This app always supplies its initialized WebGPURenderer in scene-canvas.tsx.
 * Fail explicitly if that contract changes instead of shipping an unused engine.
 */
export class WebGLRenderer {
  constructor() {
    throw new Error('The portfolio requires its custom WebGPURenderer factory.');
  }
}
