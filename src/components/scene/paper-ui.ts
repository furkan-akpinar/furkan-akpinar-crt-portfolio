import { CanvasTexture, LinearFilter, SRGBColorSpace } from "three/webgpu";
import { portfolio } from "@/content/portfolio";
import { paperEntryOffset, type CanvasActionBounds } from "./paper-action";

const SERIF = '"STIX Two Text", Georgia, serif';
export const PAPER = "#f0ead6";
// Balance only paper pixels after ACES, keeping the dark type and other scenes intact.
export const PAPER_OUTPUT_BALANCE = [1.58, 1.28, 0.82] as const;
const INK = "#332f22";
const STRIPES = ["#7c989b", "#ae96ad", "#bc817a", "#c39770", "#c5b676", "#8eaf97", "#6b9599"];

/** The typeset About sheet. The scene owns its scroll window and page curl. */
export function createPaperUI(viewportWidth: number, viewportHeight: number) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Hakkımda sayfası için çizim alanı oluşturulamadı.");
  const ctx = context;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;

  let width = Math.max(1, viewportWidth);
  let height = Math.max(1, viewportHeight);
  let viewHeight = height;
  let disposed = false;
  const images = new Map<string, HTMLImageElement>();

  function wrapped(text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
    let line = "";
    for (const word of text.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) {
        ctx.fillText(line, x, y);
        line = word;
        y += lineHeight;
      } else line = next;
    }
    if (line) ctx.fillText(line, x, y);
    return y + lineHeight;
  }

  function person(cell: number, x: number, y: number, w: number, h: number) {
    const image = images.get(portfolio.media.people);
    if (!image) return;
    const sw = image.naturalWidth / 4;
    const sh = image.naturalHeight / 2;
    ctx.drawImage(image, (cell % 4) * sw, Math.floor(cell / 4) * sh, sw, sh, x, y, w, h);
  }

  function stripes(y: number, baseWidth: number, mobile: boolean) {
    const row = mobile ? 8 : 10;
    STRIPES.forEach((color, index) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, y + index * row);
      ctx.bezierCurveTo(baseWidth * 0.3, y + index * row + 6, baseWidth * 0.7, y + index * row + 6, baseWidth, y + index * row);
      ctx.lineTo(baseWidth, y + index * row + row - 2);
      ctx.bezierCurveTo(baseWidth * 0.7, y + index * row + row + 4, baseWidth * 0.3, y + index * row + row + 4, 0, y + index * row + row - 2);
      ctx.closePath();
      ctx.fill();
    });
    ctx.fillStyle = INK;
    return y + STRIPES.length * row;
  }

  function nameRows(names: readonly string[], y: number, baseWidth: number, mobile: boolean) {
    const gap = mobile ? 120 : 300;
    const rowHeight = mobile ? 48 : 76;
    ctx.font = `500 ${mobile ? 21 : 36}px ${SERIF}`;
    for (let start = 0; start < names.length; start += 3) {
      const row = names.slice(start, start + 3);
      row.forEach((name, index) => ctx.fillText(name, baseWidth / 2 + (index - (row.length - 1) / 2) * gap, y));
      y += rowHeight;
    }
    return y;
  }

  function layout(mobile: boolean) {
    const baseWidth = mobile ? 390 : 1440;
    const scale = width / baseWidth;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, baseWidth, 6000);
    ctx.fillStyle = INK;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "center";

    // Header clearance is in viewport pixels so tablets do not inherit a scaled photo gap.
    const navigationHeight = mobile ? (width < 600 ? 68 : 105) : Math.min(1, width / 1440) * 105;
    const headlineSize = mobile ? 43 : 112;
    let y = (navigationHeight + (mobile ? 24 : 30)) / scale + headlineSize * 0.78;
    ctx.font = `500 ${headlineSize}px ${SERIF}`;
    const headline = mobile ? portfolio.about.headlineMobile : portfolio.about.headline;
    headline.forEach((line, index) => ctx.fillText(line, baseWidth / 2, y + index * headlineSize, baseWidth * 0.92));
    y += (headline.length - 1) * headlineSize + (mobile ? 45 : 95);

    ctx.textAlign = "left";
    ctx.font = `400 ${mobile ? 18 : 25}px ${SERIF}`;
    if (mobile) {
      portfolio.about.paragraphs.forEach((paragraph) => {
        y = wrapped(paragraph, 30, y, 330, 24) + 25;
      });
      person(0, 209, y - 3, 163, 217);
      y += 250;
    } else {
      const startY = y;
      let bottom = y;
      portfolio.about.paragraphs.forEach((paragraph, index) => {
        bottom = Math.max(bottom, wrapped(paragraph, [52, 430, 808][index], startY, 338, 31));
      });
      person(0, 1180, startY + 36, 240, 320);
      y = Math.max(bottom + 95, startY + 440);
    }
    y = stripes(y, baseWidth, mobile) + (mobile ? 75 : 150);

    ctx.textAlign = "center";
    ctx.font = `500 ${mobile ? 43 : 108}px ${SERIF}`;
    portfolio.about.technologiesTitle.forEach((line, index) => ctx.fillText(line, baseWidth / 2, y + index * (mobile ? 45 : 107), baseWidth * 0.9));
    y += mobile ? 88 : 182;
    ctx.font = `400 ${mobile ? 18 : 25}px ${SERIF}`;
    y = wrapped(portfolio.about.technologiesDescription, baseWidth / 2, y, mobile ? 330 : 685, mobile ? 24 : 31) + (mobile ? 40 : 65);
    y = nameRows(portfolio.about.technologies, y, baseWidth, mobile) + (mobile ? 12 : 28);
    ctx.font = `400 ${mobile ? 18 : 25}px ${SERIF}`;
    ctx.fillText(portfolio.about.toolsLabel, baseWidth / 2, y);
    y = nameRows(portfolio.about.tools, y + (mobile ? 43 : 66), baseWidth, mobile) + (mobile ? 50 : 105);
    y = stripes(y, baseWidth, mobile) + (mobile ? 82 : 152);

    const closingTop = y;
    ctx.textAlign = mobile ? "center" : "left";
    ctx.font = `500 ${mobile ? 38 : 87}px ${SERIF}`;
    const closingLines = mobile ? portfolio.about.closingHeadlineMobile : portfolio.about.closingHeadline;
    closingLines.forEach((line, index) => ctx.fillText(line, mobile ? baseWidth / 2 : 78, y + index * (mobile ? 42 : 96), baseWidth * (mobile ? 0.92 : 0.58)));
    y += (closingLines.length - 1) * (mobile ? 42 : 96) + (mobile ? 45 : 70);
    ctx.textAlign = "left";
    ctx.font = `400 ${mobile ? 18 : 25}px ${SERIF}`;
    y = wrapped(portfolio.about.closingParagraph, mobile ? 30 : 78, y, mobile ? 330 : 655, mobile ? 24 : 31);
    if (mobile) {
      person(0, 79, y + 25, 232, 309);
      y += 379;
    } else {
      person(0, 920, closingTop - 70, 410, 547);
      y = Math.max(y + 90, closingTop + 525);
    }
    return y;
  }

  function draw() {
    if (disposed) return;
    const mobile = width < 900;
    const baseWidth = mobile ? 390 : 1440;
    const scale = width / baseWidth;
    // Measure copy first, then allocate a texture that ends after the closing statement.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const baseHeight = layout(mobile);
    height = Math.max(viewHeight, Math.ceil(baseHeight * scale));
    const ratio = Math.min(window.devicePixelRatio || 1, 1.25, 8192 / height, 8192 / width);
    const nextWidth = Math.ceil(width * ratio);
    const nextHeight = Math.ceil(height * ratio);
    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      texture.dispose();
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    }
    ctx.setTransform(scale * ratio, 0, 0, scale * ratio, 0, 0);
    layout(mobile);
    texture.needsUpdate = true;
  }

  function resize(nextWidth: number, nextHeight: number) {
    if (disposed) return;
    width = Math.max(1, nextWidth);
    viewHeight = Math.max(1, nextHeight);
    draw();
  }

  const ready = new Promise<void>((resolve) => {
    const image = new Image();
    image.onload = () => {
      if (!disposed) images.set(portfolio.media.people, image);
      resolve();
    };
    image.onerror = () => resolve();
    image.src = portfolio.media.people;
  }).then(() => { if (!disposed) draw(); });

  function dispose() {
    if (disposed) return;
    disposed = true;
    texture.dispose();
    images.clear();
    canvas.width = 1;
    canvas.height = 1;
  }

  draw();
  return { texture, ready, resize, dispose,
    get entryOffset() { return paperEntryOffset(width); },
    get actionBounds(): CanvasActionBounds | null { return null; },
    get width() { return width; }, get height() { return height; } };
}
