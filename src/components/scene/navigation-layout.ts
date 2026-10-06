export type NavigationSection = 'hero' | 'projects' | 'about-us' | 'contact';
export const NAVIGATION_BREAKPOINT = 900;
export const NAVIGATION_SERIF = '"STIX Two Text", Georgia, serif';

export interface NavigationRect { x: number; y: number; width: number; height: number }
interface NavigationContent {
  name: string;
  callLabel: string;
  nav: readonly { label: string; target: string }[];
}
type MeasureText = (text: string, font: string) => number;

/** These same logical-pixel bounds drive Canvas2D and the semantic controls. */
export function navigationLayout(width: number, measure: MeasureText, content: NavigationContent) {
  const compact = width < NAVIGATION_BREAKPOINT;
  const phone = width < 600;
  const scale = compact ? 1 : Math.min(1, width / 1440);
  const height = compact ? (phone ? 64 : 105) : 105 * scale;
  const brandSize = compact ? (phone ? 27 : 34) : 31 * scale;
  const fontSize = compact ? (phone ? 20 : 22) : 22 * scale;
  const font = `500 ${fontSize}px ${NAVIGATION_SERIF}`;
  const brandFont = `italic 700 ${brandSize}px ${NAVIGATION_SERIF}`;
  const callFont = `400 ${24 * scale}px ${NAVIGATION_SERIF}`;
  const mark = compact
    ? { x: phone ? 15 : 28, y: phone ? 25 : 43, width: phone ? 34 : 40, height: phone ? 21 : 25 }
    : { x: 33 * scale, y: 43 * scale, width: 40 * scale, height: 25 * scale };
  const brand = { x: mark.x + mark.width + (phone && compact ? 9 : 11 * scale), baseline: compact ? (phone ? 45 : 66) : 66 * scale };
  const brandWidth = measure(content.name, brandFont);
  const logo = { x: mark.x - 5, y: Math.max(0, brand.baseline - brandSize - 7), width: brand.x + brandWidth - mark.x + 10, height: Math.max(44, brandSize + 14) };
  const menu = { x: width - (phone ? 62 : 74), y: height / 2 - 22, width: 44, height: 44 };
  const popup = { x: Math.max(8, width - 216), y: height + 5, width: Math.min(200, width - 16), height: content.nav.length * 46 };
  const widths = content.nav.map(item => measure(item.label, font));
  const gap = 44 * scale;
  const total = widths.reduce((sum, value) => sum + value, 0) + gap * (widths.length - 1);
  let x = width / 2 - total / 2;
  const links = content.nav.map((item, index) => {
    const bounds = compact
      ? { x: popup.x, y: popup.y + index * 46, width: popup.width, height: 46 }
      : { x: x - 10 * scale, y: 56 * scale - 31, width: widths[index] + 20 * scale, height: 44 };
    const textX = compact ? bounds.x + 15 : x;
    const baseline = compact ? bounds.y + 29 : 56 * scale;
    x += widths[index] + gap;
    return { ...item, bounds, textX, baseline };
  });
  const callWidth = measure(content.callLabel, callFont);
  const call = {
    textX: width - 44 * scale - callWidth,
    baseline: 60 * scale,
    iconX: width - 74 * scale - callWidth,
    iconY: 53 * scale,
    iconSize: 20 * scale,
    bounds: { x: width - 91 * scale - callWidth, y: 60 * scale - 32, width: callWidth + 58 * scale, height: 44 },
  };
  return { compact, height, font, fontSize, brandFont, callFont, mark, brand, logo, menu, popup, links, call };
}

export type NavigationLayout = ReturnType<typeof navigationLayout>;

export function navigationSection(scene: string): NavigationSection {
  if (scene === 'hero' || scene === 'projects' || scene === 'contact') return scene;
  if (scene === 'golden-tie-reveal' || scene === 'golden-tie') return 'contact';
  return 'about-us';
}
