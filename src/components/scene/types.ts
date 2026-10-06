export type RendererStatus = "loading" | "webgpu" | "webgl2" | "fallback";

import type { RefObject } from 'react';
import type { SceneRuntime } from './runtime';
import type { CanvasActionBounds } from './paper-action';

export interface SceneCanvasProps {
  onStatus: (status: RendererStatus) => void;
  reducedMotion: boolean;
  runtime: RefObject<SceneRuntime>;
  onPaperActionBounds: (bounds: CanvasActionBounds | null) => void;
}
