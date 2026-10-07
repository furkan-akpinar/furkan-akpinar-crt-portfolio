/** A single composition. Small screens scroll only the pixels that do not fit. */
export function contactLayout(width: number, height: number, progress = 0, storyHeight = height) {
  const mobile = width < 650;
  const scale = mobile ? Math.min(1, width / 390) : Math.min(width / (width < 900 ? 1000 : 1440), height / 900);
  const headerHeight = width < 600 ? 64 : width < 900 ? 105 : 105 * Math.min(1, width / 1440);
  const boxY = mobile ? 235 : 150;
  const boxWidth = mobile ? 336 : 680;
  const boxHeight = mobile ? 164 : 190;
  const footerY = mobile ? 444 : 370;
  const brandY = footerY + (mobile ? 54 : 50);
  const contentUnits = (mobile ? 215 : 235) + brandY + (mobile ? 73 : 108);
  const breathingRoom = Math.max(0, height - headerHeight - contentUnits * scale) / 2;
  const detailsTop = headerHeight + breathingRoom + (mobile ? 215 : 235) * scale;
  const titleSize = mobile ? Math.min(34, width * 0.084) : Math.min(78, 52 * scale);
  const titleBaseline = headerHeight + breathingRoom + (mobile ? 65 : 70) * scale;
  const subtitleSize = mobile ? 16 * scale : Math.max(16, 20 * scale);
  const contentBottom = detailsTop + (brandY + (mobile ? 73 : 108)) * scale;
  const travel = Math.max(0, contentBottom - height);
  // The scene's virtual range remains 1.5vh, while its physical range is only
  // `travel`. Earlier scenes keep their established absolute scroll positions.
  const offset = Math.min(travel, Math.max(0, Number.isFinite(progress) ? progress : 0) * 1.5 * storyHeight);
  const rect = (x: number, y: number, w: number, h: number) => ({
    x: width / 2 + x * scale, y: detailsTop + y * scale - offset,
    width: w * scale, height: h * scale,
  });
  return { mobile, scale, detailsTop, offset, travel, boxY, boxWidth, boxHeight, footerY, brandY,
    titleBaseline, titleSize, subtitleSize,
    github: rect(mobile ? -100 : -445, 24, mobile ? 200 : 280, 80),
    invitation: rect(-boxWidth / 2, boxY, boxWidth, boxHeight),
  };
}
