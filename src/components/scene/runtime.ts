import { clampProgress, scenes, SCROLL_SCREENS, type SceneId } from '../../config/scenes.ts';
export { SCROLL_SCREENS } from '../../config/scenes.ts';

/** Mutable frame data; pointer/scroll/animation never trigger React renders. */
export interface SceneRuntime {
  storyHeight: number;
  sceneHeight: number;
  visibleHeight: number;
  scrollPosition: number;
  scrollLimit: number;
  controlledScroll: boolean;
  progress: number;
  intro: number;
  bootProgress: number;
  time: number;
  pointerX: number;
  pointerY: number;
  projectIndex: number;
  projectPosition: number;
  projectTarget: number;
  projectFrom: number;
  projectMotion: number;
  menuOpen: boolean;
  hovered: string;
  reducedMotion: boolean;
  menuSignalActive: boolean;
  menuSignalProgress: number;
}
export function createRuntime(): SceneRuntime {
  return { storyHeight: 0, sceneHeight: 0, visibleHeight: 0, scrollPosition: 0, scrollLimit: 0, controlledScroll: false, progress: 0, intro: 0, bootProgress: 0, time: 0, pointerX: 0, pointerY: 0, projectIndex: 0, projectPosition: 0, projectTarget: 0, projectFrom: 0, projectMotion: 1, menuOpen: false, hovered: '', reducedMotion: false, menuSignalActive: false, menuSignalProgress: 0 };
}
export function heroTravel(progress: number) {
  return clampProgress(progress / scenes[0].end);
}
/** The final page can fit without using its whole virtual scene span. Earlier
 * transitions therefore follow viewport distance, never the document's end. */
export function storyProgress(scroll: number, height: number) {
  if (!Number.isFinite(height) || height <= 0) return 0;
  return clampProgress(scroll / (SCROLL_SCREENS * height));
}
export function sceneScrollTop(id: SceneId, height: number) {
  // Saved links to removed scenes resolve to their surviving destination.
  const target = id === 'office' ? 'about-us' : id === 'golden-tie' || id === 'golden-tie-reveal' ? 'contact' : id;
  const scene = scenes.find(entry => entry.id === target)!;
  // Browsers round fractional scroll offsets; land inside the requested scene.
  return scene.start === 0 ? 0 : Math.ceil(scene.start * SCROLL_SCREENS * height) + 2;
}
