/**
 * A small deformation rig for the project's original, still-image crowd atlas.
 * This is not a recovered photographic animation or the source site's rig.
 * Coordinates are local cell UVs: u left→right, v bottom→top. Do not pass the
 * 4×2 atlas-remapped UVs. The caller owns time, scrolling and reduced motion.
 */
export type ClapDisplacement = { du: number; dv: number };
type PixelPoint = readonly [x: number, y: number];
type Arm = { readonly elbow: PixelPoint; readonly hand: PixelPoint };
type ClapRig = { readonly arms: readonly [Arm, Arm]; readonly travel: number };

export const clapCellSize = { width: 384, height: 512 } as const;

/** Palm/elbow centers measured from public/images/people-atlas.png. */
export const clapRigs: readonly ClapRig[] = [
  { arms: [{ elbow: [207, 182], hand: [277, 128] }, { elbow: [305, 180], hand: [298, 121] }], travel: 16 },
  { arms: [{ elbow: [166, 185], hand: [229, 131] }, { elbow: [263, 177], hand: [250, 120] }], travel: 16 },
  { arms: [{ elbow: [133, 197], hand: [201, 150] }, { elbow: [249, 191], hand: [222, 141] }], travel: 15 },
  { arms: [{ elbow: [129, 196], hand: [155, 149] }, { elbow: [218, 188], hand: [186, 156] }], travel: 16 },
  { arms: [{ elbow: [192, 182], hand: [255, 134] }, { elbow: [297, 189], hand: [279, 129] }], travel: 17 },
  { arms: [{ elbow: [186, 181], hand: [259, 128] }, { elbow: [292, 176], hand: [278, 116] }], travel: 16 },
  { arms: [{ elbow: [177, 183], hand: [235, 133] }, { elbow: [282, 178], hand: [278, 128] }], travel: 18 },
  { arms: [{ elbow: [109, 174], hand: [129, 123] }, { elbow: [210, 180], hand: [147, 130] }], travel: 16 },
];

const clamp = (value: number) => Math.max(0, Math.min(1, value));
function smooth(value: number) { const t = clamp(value); return t * t * (3 - 2 * t); }

/** 0/1 are open; .5 is the still atlas's close/contact pose. */
export function clapOpenness(phase: number) {
  if (!Number.isFinite(phase)) return 0;
  const cycle = ((phase % 1) + 1) % 1;
  return (1 + Math.cos(cycle * Math.PI * 2)) / 2;
}

function armWeight(x: number, y: number, arm: Arm) {
  const [ex, ey] = arm.elbow, [hx, hy] = arm.hand;
  const dx = hx - ex, dy = hy - ey;
  const along = clamp(((x - ex) * dx + (y - ey) * dy) / (dx * dx + dy * dy));
  const distance = Math.hypot(x - ex - along * dx, y - ey - along * dy);
  const forearm = smooth((along - 0.13) / 0.87) * (1 - smooth((distance - 7) / 14));
  // The central palm/fingers translate together. Compact support fades through
  // the surrounding transparent margin, rather than shearing the whole torso.
  const handDistance = Math.hypot((x - hx) / 20, (y - hy) / 38);
  const hand = 1 - smooth((handDistance - 0.76) / 0.24);
  const elbowAnchor = smooth(Math.hypot(x - ex, y - ey) / 17);
  return Math.max(forearm, hand) * elbowAnchor;
}

/**
 * Sample normalized UV displacement, never a cumulative position. For the
 * render loop, cache clapPoint(index,u,v,0) once per vertex and multiply those
 * two values by clapOpenness(phase); the spatial rig is phase independent.
 * A segmented plane is required (e.g. 64×96). Keep its UVs/alpha unchanged.
 */
export function clapPoint(index: number, u: number, v: number, phase: number): ClapDisplacement {
  const rig = clapRigs[index];
  if (!rig || !Number.isFinite(u) || !Number.isFinite(v) || !Number.isFinite(phase)) return { du: 0, dv: 0 };
  const x = u * clapCellSize.width, y = (1 - v) * clapCellSize.height;
  if (x < 0 || x > clapCellSize.width || y < 76 || y > 223) return { du: 0, dv: 0 };
  const a = armWeight(x, y, rig.arms[0]), b = armWeight(x, y, rig.arms[1]);
  const sum = a ** 4 + b ** 4;
  if (sum < 1e-12) return { du: 0, dv: 0 };
  // A smooth nearest-arm assignment lets the two hands move oppositely even
  // where their support regions overlap, with no discontinuous seam.
  const direction = (b ** 4 - a ** 4) / sum;
  // Keep still-image wrists within a modest deformation range; the source
  // photographs do not contain the occluded fingers of a fully open clap.
  const amount = direction * Math.max(a, b) * rig.travel * 0.65 * clapOpenness(phase);
  const dx = rig.arms[1].hand[0] - rig.arms[0].hand[0];
  const dy = rig.arms[1].hand[1] - rig.arms[0].hand[1];
  const length = Math.hypot(dx, dy);
  return { du: dx / length * amount / clapCellSize.width, dv: -dy / length * amount / clapCellSize.height };
}
