import { navigationSection } from './navigation-layout.ts';
import type { SceneId } from '../../config/scenes.ts';
import { introGestureDefaults } from './intro-gesture.ts';

export const MENU_SIGNAL_DURATION = 1.2;
export interface MenuNavigationRequest {
  top: number;
  id: SceneId;
  signal: boolean;
  origin?: 'menu' | 'cta';
}

/** Only the two menu routes through the monitor use the wheel's exact endpoint
 * and duration. Other menu transitions and the separate hero CTA keep theirs. */
export function monitorMenuTransition(from: string, to: string, height: number) {
  if (!((from === 'hero' && to === 'projects') || (from === 'projects' && to === 'hero'))) return null;
  return {
    top: to === 'projects' ? introGestureDefaults.projectsSnapVh * height : 0,
    duration: introGestureDefaults.snapDurationMs / 1000,
  };
}

/** Menu-only transition: the physical monitor journey keeps its own motion. */
export function shouldUseMenuSignal(from: string, to: string): boolean {
  const source = navigationSection(from);
  const target = navigationSection(to);
  if (source === target) return false;
  return !((source === 'hero' && target === 'projects') || (source === 'projects' && target === 'hero'));
}
