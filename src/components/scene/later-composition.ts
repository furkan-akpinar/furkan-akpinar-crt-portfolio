const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

/** Mobile reference 33/35: a cropped foreground and a lower closing view. */
export function mobilePhoneFraming(progress: number) {
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  return {
    cameraY: 6 - smooth(p) * 1.6 - 1.95 * smooth((p - 0.26) / 0.3),
    scale: 1.65 - 0.15 * smooth((p - 0.3) / 0.3),
  };
}

export const mobilePhoneOffsets = [
  { x: -0.1, z: 0.35 },
  { x: -0.4, z: 0 },
  { x: 0.3, z: 0.5 },
] as const;

/** Fixed lateral spacing and deep Z steps form an aisle in both viewports. */
export function tieAudiencePlacement(index: number) {
  const depth = index % 4;
  const side = index < 4 ? -1 : 1;
  return {
    x: side * [3.9, 4.15, 4.2, 4.3][depth],
    y: [-0.38, -0.32, -0.28, -0.25][depth],
    z: [1.8, -4, -10, -16][depth],
    scale: [1.1, 1.1, 1.15, 1.16][depth],
    facing: index === 3 || (index >= 4 && index < 7) ? -1 : 1,
  };
}
