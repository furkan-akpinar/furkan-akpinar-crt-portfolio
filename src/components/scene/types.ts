export type RendererStatus = "loading" | "webgpu" | "webgl2" | "fallback";

import type { RefObject } from 'react';
import type { SceneRuntime } from './runtime';

export interface SceneCanvasProps {
  onStatus: (status: RendererStatus) => void;
  runtime: RefObject<SceneRuntime>;
}
