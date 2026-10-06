/** Absolute viewport spans preserve the monitor dive, project aperture and About
 * curl. The blue statement now starts Contact; removed scenes retain legacy IDs
 * so saved navigation targets can resolve to the remaining sections. */
export type SceneId = "hero" | "projects" | "office" | "about-us" | "golden-tie-reveal" | "golden-tie" | "contact";
export const SCROLL_SCREENS = 15.1;
export interface SceneDefinition {
  id: SceneId;
  label: string;
  start: number;
  end: number;
}

export const scenes: readonly SceneDefinition[] = [
  { id: "hero", label: "Ana Sayfa", start: 0, end: 1.4 / SCROLL_SCREENS },
  { id: "projects", label: "Projeler", start: 1.4 / SCROLL_SCREENS, end: 5.6 / SCROLL_SCREENS },
  { id: "about-us", label: "Hakkımda", start: 5.6 / SCROLL_SCREENS, end: 13.6 / SCROLL_SCREENS },
  { id: "contact", label: "İletişim", start: 13.6 / SCROLL_SCREENS, end: 1 },
];

export function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function validateTimeline(timeline: readonly SceneDefinition[]): void {
  if (timeline.length === 0 || timeline[0].start !== 0 || timeline.at(-1)?.end !== 1) {
    throw new Error("The scene timeline must cover the complete 0–1 interval.");
  }
  timeline.forEach((scene, index) => {
    if (!Number.isFinite(scene.start) || !Number.isFinite(scene.end) || scene.start >= scene.end ||
      scene.start < 0 || scene.end > 1 || (index > 0 && timeline[index - 1].end !== scene.start)) {
      throw new Error(`Invalid or discontinuous scene range: ${scene.id}`);
    }
  });
}

export function getSceneState(value: number, timeline: readonly SceneDefinition[] = scenes) {
  validateTimeline(timeline);
  const progress = clampProgress(value);
  const scene = timeline.find((entry) => progress < entry.end) ?? timeline[timeline.length - 1];
  return { scene, progress, localProgress: clampProgress((progress - scene.start) / (scene.end - scene.start)) };
}
