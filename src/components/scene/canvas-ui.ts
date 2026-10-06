import { CanvasTexture, LinearFilter, SRGBColorSpace } from "three/webgpu";
import { portfolio } from "@/content/portfolio";
import { contactLayout } from "./contact-layout";
import { heroPromptLayout } from "./hero-copy-layout";
import { navigationLayout, type NavigationSection } from "./navigation-layout";
import { curlCovers } from "./page-curl-geometry";
import { projectCaptionLayout } from "./project-caption-layout";

export interface UIOptions {
  mode: "hero" | "projects" | "project-title" | "office" | "about-us" | "golden-tie-reveal" | "golden-tie" | "contact" | "boot" | "header";
  /** Progress of the physical camera move into the computer's screen. */
  progress: number;
  bootProgress: number;
  projectIndex: number;
  /** Local progress through this scene. Camera progress remains separate. */
  sceneProgress?: number;
  headerVisible?: boolean;
  headerDark?: boolean;
  legacyHeader?: boolean;
  heroHeader?: boolean;
  menuOpen?: boolean;
  hovered?: string;
  activeSection?: NavigationSection;
  /** About exit only: the fixed header follows the surface beneath each item. */
  paperCurl?: number;
  /** Cumulative 0 → 1 → 2 → 3 marks; sampled by the shared scene clock. */
  heroPromptCount?: number;
}

const INK = "#eee9dc";
const SERIF = '"STIX Two Text", Georgia, serif';
const BOOT_MONO = '"VT323", monospace';
const clamp = (value: number) => Math.max(0, Math.min(1, value));

/**
 * Original Canvas2D artwork, uploaded into the same render pipeline as the 3D
 * scenes. This is deliberately not a screenshot of a DOM overlay. Interaction
 * and the accessible equivalent are owned by the scene's semantic controls.
 */
export function createCanvasUI(width: number, height: number) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("The canvas UI could not initialize its 2D context.");
  const ctx = context;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;

  let logicalWidth = 1;
  let logicalHeight = 1;
  let pixelRatio = 1;
  let disposed = false;
  let lastOptions: UIOptions | undefined;
  const portrait = new Image();
  portrait.onload = () => { if (lastOptions && !disposed) draw(lastOptions); };
  portrait.src = portfolio.media.team;

  function resize(nextWidth: number, nextHeight: number) {
    if (disposed) return;
    logicalWidth = Math.max(1, nextWidth);
    logicalHeight = Math.max(1, nextHeight);
    pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    texture.dispose(); // Reallocate the GPU texture after a backing-store resize.
    canvas.width = Math.round(logicalWidth * pixelRatio);
    canvas.height = Math.round(logicalHeight * pixelRatio);
    texture.needsUpdate = true;
  }

  /** A newly drawn oval with offset rainbow scan lines, not a copied logo asset. */
  function mark(x: number, y: number, w: number, h: number, monochrome = false) {
    const stripes = ["#667de5", "#8b52c6", "#de5a59", "#e59b47", "#ead466", "#70b18b", "#43a9a3", "#547fba"];
    const rows = stripes.length;
    const rowHeight = h / rows;
    for (let i = 0; i < rows; i++) {
      const fromCenter = (i + 0.5 - rows / 2) / (rows / 2);
      const chord = Math.sqrt(1 - fromCenter * fromCenter);
      const right = x + w * (0.53 + 0.47 * chord);
      const left = x + w * (0.53 - 0.43 * chord);
      const trailing = w * (0.07 + (i % 3) * 0.035);
      ctx.fillStyle = monochrome ? INK : stripes[i];
      ctx.fillRect(left - trailing, y + i * rowHeight, right - left + trailing, rowHeight * 0.72);
    }
  }

  function arrow(x: number, y: number, size: number, direction: "left" | "right" | "down") {
    ctx.save();
    ctx.translate(x, y);
    if (direction === "left") ctx.rotate(Math.PI);
    if (direction === "down") ctx.rotate(Math.PI / 2);
    ctx.lineWidth = Math.max(1.2, size * 0.07);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(-size * 0.5, 0);
    ctx.lineTo(size * 0.5, 0);
    ctx.moveTo(size * 0.13, -size * 0.36);
    ctx.lineTo(size * 0.5, 0);
    ctx.lineTo(size * 0.13, size * 0.36);
    ctx.stroke();
    ctx.restore();
  }

  function phoneIcon(x: number, y: number, size: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.lineWidth = size * 0.12;
    ctx.beginPath();
    ctx.arc(0, -size * 0.1, size * 0.47, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
    ctx.fillRect(-size * 0.47, -size * 0.1, size * 0.22, size * 0.2);
    ctx.fillRect(size * 0.25, -size * 0.1, size * 0.22, size * 0.2);
    ctx.beginPath();
    ctx.moveTo(-size * 0.24, 0);
    ctx.lineTo(size * 0.24, 0);
    ctx.lineTo(size * 0.37, size * 0.42);
    ctx.lineTo(-size * 0.37, size * 0.42);
    ctx.closePath();
    ctx.stroke();
    for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) {
      ctx.fillRect((col - 1) * size * 0.12 - size * 0.025, size * (0.13 + row * 0.12), size * 0.05, size * 0.05);
    }
    ctx.restore();
  }

  function hollowPromptArrow(x: number, y: number, size: number, direction: 'right' | 'down') {
    ctx.save();
    ctx.translate(x, y);
    if (direction === 'down') ctx.rotate(Math.PI / 2);
    ctx.lineWidth = Math.max(1.15, size * 0.047);
    ctx.lineJoin = 'miter';
    // Closed outline, transparent shaft/head. The shared CRT pass supplies
    // the same phosphor softness and colour fringe as the adjacent text.
    ctx.beginPath();
    ctx.moveTo(-size * 0.5, -size * 0.13);
    ctx.lineTo(size * 0.07, -size * 0.13);
    ctx.lineTo(size * 0.07, -size * 0.34);
    ctx.lineTo(size * 0.5, 0);
    ctx.lineTo(size * 0.07, size * 0.34);
    ctx.lineTo(size * 0.07, size * 0.13);
    ctx.lineTo(-size * 0.5, size * 0.13);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  function underline(text: string, x: number, baseline: number, active: boolean) {
    const measured = ctx.measureText(text).width;
    ctx.fillText(text, x, baseline);
    if (active) {
      ctx.beginPath();
      ctx.moveTo(x, baseline + 4);
      ctx.lineTo(x + measured, baseline + 4);
      ctx.stroke();
    }
    return measured;
  }

  function header(options: UIOptions) {
    const w = logicalWidth;
    const content = portfolio.home;
    const layout = navigationLayout(w, (text, font) => { ctx.font = font; return ctx.measureText(text).width; }, content);
    const activeSection = options.activeSection ?? 'hero';
    ctx.save();
    if (layout.compact && options.menuOpen) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      ctx.fillRect(0, 0, w, logicalHeight);
    }
    const inkAt = (x: number, y: number) => {
      const onPaper = options.paperCurl === undefined ? options.headerDark : curlCovers(options.paperCurl, w / logicalHeight, x / w, y / logicalHeight);
      return onPaper ? '#171711' : INK;
    };
    const setInk = (x: number, y: number) => { ctx.fillStyle = inkAt(x, y); ctx.strokeStyle = ctx.fillStyle; };
    ctx.lineWidth = 1;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    mark(layout.mark.x, layout.mark.y, layout.mark.width, layout.mark.height);
    setInk(layout.brand.x + (layout.logo.x + layout.logo.width - layout.brand.x) / 2, layout.brand.baseline - 12);
    ctx.font = layout.brandFont;
    ctx.fillText(content.name, layout.brand.x, layout.brand.baseline);
    if (layout.compact) {
      const menuX = layout.menu.x + layout.menu.width / 2;
      const menuY = layout.menu.y + layout.menu.height / 2;
      setInk(menuX, menuY);
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let row = 0; row < 3; row++) {
        ctx.moveTo(menuX - 8, menuY - 6 + row * 6);
        ctx.lineTo(menuX + 8, menuY - 6 + row * 6);
      }
      ctx.stroke();
      if (options.menuOpen) {
        const box = layout.popup;
        ctx.fillStyle = '#050505';
        ctx.strokeStyle = 'rgba(238,233,220,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(box.x, box.y, box.width, box.height, 4);
        ctx.fill();ctx.stroke();
        ctx.font = layout.font;
        layout.links.forEach((item, index) => {
          if (options.hovered === item.target) {
            ctx.fillStyle = '#232321';
            ctx.fillRect(item.bounds.x + 1, item.bounds.y + 1, item.bounds.width - 2, item.bounds.height - 2);
          }
          if (index > 0) {
            ctx.beginPath();ctx.moveTo(box.x, item.bounds.y);ctx.lineTo(box.x + box.width, item.bounds.y);ctx.stroke();
          }
          ctx.fillStyle = INK;
          ctx.fillText(item.label, item.textX, item.baseline);
        });
      }
    } else {
      ctx.font = layout.font;
      layout.links.forEach(item => {
        ctx.globalAlpha = options.hovered === item.target ? 0.72 : 1;
        setInk(item.bounds.x + item.bounds.width / 2, item.baseline - layout.fontSize / 3);
        underline(item.label, item.textX, item.baseline, item.target !== activeSection);
      });
      ctx.globalAlpha = options.hovered === 'contact-cta' ? 0.72 : 1;
      ctx.font = layout.callFont;
      setInk(layout.call.textX + ctx.measureText(content.callLabel).width / 2, layout.call.baseline - 8);
      underline(content.callLabel, layout.call.textX, layout.call.baseline, true);
      setInk(layout.call.iconX, layout.call.iconY);
      phoneIcon(layout.call.iconX, layout.call.iconY, layout.call.iconSize);
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.1;
    for (let x = 0; x < w; x += 24) {
      ctx.strokeStyle = inkAt(Math.min(x + 12, w), layout.height);
      ctx.beginPath();ctx.moveTo(x, layout.height);ctx.lineTo(Math.min(x + 24, w), layout.height);ctx.stroke();
    }
    ctx.restore();
  }

  function hero(options: UIOptions, mobile: boolean, scale: number) {
    const progress = clamp(options.progress);
    const departure = clamp((progress - 0.12) / 0.5);
    ctx.save();
    ctx.globalAlpha = 1 - departure * departure * (3 - 2 * departure);
    // The UI leaves the camera's view while the actual monitor fills that view.
    // The downstream scene transition is a render-target/camera operation.
    ctx.translate(-progress * logicalWidth * (mobile ? 0.35 : 0.48), -progress * logicalHeight * 0.28);
    const magnification = 1 + progress * 0.8;
    ctx.scale(magnification, magnification);
    ctx.fillStyle = INK;
    ctx.strokeStyle = INK;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = mobile ? "center" : "left";
    // Keep the four-line composition; fit the longer Turkish words to its column.
    let fontSize = mobile ? Math.min(44, logicalWidth * 0.113) : 96 * Math.min(scale, 1);
    const lines = mobile ? portfolio.heroLinesMobile : portfolio.heroLinesDesktop;
    ctx.font = `${mobile ? 400 : 500} ${fontSize}px ${SERIF}`;
    ctx.letterSpacing = `${mobile ? 0.5 : 0.25 * scale}px`;
    const availableWidth = mobile ? Math.min(logicalWidth - 40, 560) : 685 * Math.min(scale, 1);
    const widest = Math.max(...lines.map(line => ctx.measureText(line).width));
    fontSize *= Math.min(1, availableWidth / widest);
    ctx.font = `${mobile ? 400 : 500} ${fontSize}px ${SERIF}`;
    const desktopScale=Math.min(scale,1),extraHeight=Math.max(0,logicalHeight-900);
    const x = mobile ? logicalWidth * 0.5 : 96*desktopScale+Math.max(0,logicalWidth-1440)*0.15;
    const firstBaseline = mobile ? 143 : 265*desktopScale+extraHeight*0.455;
    const lineHeight = mobile ? 49 : 100*desktopScale;
    lines.forEach((line, index) => ctx.fillText(line, x, firstBaseline + index * lineHeight));

    ctx.letterSpacing = "0px";
    ctx.font = `400 ${mobile ? 18 : 22*desktopScale}px ${SERIF}`;
    wrapped(portfolio.home.description, x, mobile ? 332 : 626*desktopScale+extraHeight*0.51,
      mobile ? Math.min(logicalWidth-42, 540) : 610*desktopScale, mobile ? 23 : 29*desktopScale);
    const prompt = heroPromptLayout(logicalWidth, logicalHeight);
    ctx.font = `400 ${prompt.fontSize}px ${SERIF}`;
    const promptY = prompt.baseline;
    const promptX = prompt.x;
    const promptWidth = ctx.measureText(portfolio.prompt).width;
    ctx.fillText(portfolio.prompt, promptX, promptY);
    const pitch = prompt.arrowSize + prompt.arrowGap;
    const firstArrow = mobile ? promptX - pitch : promptX + promptWidth + 20 * desktopScale + prompt.arrowSize / 2;
    for (let index = 0; index < (options.heroPromptCount ?? 3); index++) {
      hollowPromptArrow(firstArrow + index * pitch, prompt.arrowY, prompt.arrowSize, prompt.arrowDirection);
    }
    ctx.restore();
  }

  function projects(options: UIOptions, mobile: boolean, scale: number) {
    const w = logicalWidth;
    const h = logicalHeight;
    ctx.save();
    const departure = clamp((options.sceneProgress ?? 0) / 0.25);
    ctx.globalAlpha = 1 - departure * departure * (3 - 2 * departure);
    ctx.textAlign = "center";
    ctx.fillStyle = INK;
    ctx.strokeStyle = INK;
    const count = portfolio.projects.length;
    const active = ((options.projectIndex % count) + count) % count;
    const project = portfolio.projects[active];
    ctx.font = `400 ${mobile ? Math.min(43, w * 0.1103) : 76 * scale}px ${SERIF}`;
    // Fresh eHealth reference at 1440x900 / 1918x955: title baseline tracks
    // 24% of height. The distant film stays behind this caption corridor.
    if (options.mode === 'project-title') {
    ctx.fillText(project.title, w * 0.5, mobile ? 214 : h * 0.24, w * 0.89);
    const caption=projectCaptionLayout(w,h);
    ctx.font = `400 ${caption.fontSize}px ${SERIF}`;
    // The reference caption has a softer ink core than the display title.
    // Keep the regular font metrics; reduce only this caption's coverage.
    ctx.globalAlpha *= 0.84;
    ctx.lineWidth=Math.max(.7,scale);
    for(const [label,bounds,available] of [
      [project.repository===portfolio.github?'GitHub profili':'GitHub reposu',caption.repository,!!project.repository],
      ['Web sitesi →',caption.website,true],
    ] as const){
      ctx.save();
      if(!available)ctx.globalAlpha*=.5;
      const x=bounds.x+bounds.width/2;
      ctx.fillText(label,x,caption.baseline);
      const textWidth=ctx.measureText(label).width;
      if(available){ctx.beginPath();ctx.moveTo(x-textWidth/2,caption.baseline+3);ctx.lineTo(x+textWidth/2,caption.baseline+3);ctx.stroke();}
      ctx.restore();
    }
    ctx.restore(); return;
    }
    // Match the semantic 54px controls: desktop 6% from either side / 7%
    // from the bottom; mobile 7% from either side / 5% from the bottom.
    const buttonSize = 54;
    const halfButton = buttonSize / 2;
    const controlY = h * (mobile ? 0.95 : 0.93) - halfButton;
    const controlX = w * (mobile ? 0.07 : 0.05) + halfButton;
    for (const x of [controlX, w - controlX]) {
      ctx.fillStyle = "#09090b";
      ctx.beginPath();
      ctx.roundRect(x - halfButton, controlY - halfButton, buttonSize, buttonSize, 3);
      ctx.fill();
    }
    arrow(controlX, controlY, mobile ? 28 : 32, "left");
    arrow(w - controlX, controlY, mobile ? 28 : 32, "right");
    ctx.fillStyle = INK;
    const dotSpace = mobile ? 17 : 24;
    for (let index = 0; index < count; index++) {
      ctx.globalAlpha = (1 - departure * departure * (3 - 2 * departure)) * (index === active ? 1 : 0.35);
      ctx.beginPath();
      const dotX=w * 0.5 + (index - (count - 1) / 2) * dotSpace;
      const dotY=controlY+(mobile?0:17);
      ctx.arc(dotX, dotY, 2.5, 0, Math.PI * 2);
      ctx.fill();
      if(index===active){ctx.beginPath();ctx.arc(dotX,dotY,7,0,Math.PI*2);ctx.lineWidth=1;ctx.stroke();}
    }
    ctx.restore();
  }

  function wrapped(text: string, x: number, baseline: number, maxWidth: number, lineHeight: number) {
    const words = text.split(" ");
    let line = "";
    let y = baseline;
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        ctx.fillText(line, x, y);
        y += lineHeight;
        line = word;
      } else line = candidate;
    }
    if (line) ctx.fillText(line, x, y);
  }

  function office(options: UIOptions, mobile: boolean, scale: number) {
    const progress = clamp(options.sceneProgress ?? 0);
    ctx.save();
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    ctx.font = `${mobile ? 400 : 500} ${mobile ? logicalWidth * 0.197 : 144 * scale}px ${SERIF}`;
    ctx.fillText(portfolio.about.title, logicalWidth / 2, (mobile ? 191 : 186 * scale) - Math.max(0, progress - 0.52) * logicalHeight * 1.6);
    ctx.restore();
  }

  function reveal(mobile: boolean, placement?: { titleBaseline: number; titleSize: number; subtitleSize: number }) {
    ctx.save();
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    // The paper uncovers a stationary destination. Its type never grows or
    // departs toward the removed tie scene as local progress advances.
    let fontSize = placement?.titleSize ?? (mobile ? Math.min(34, logicalWidth * 0.084) : Math.min(78, logicalWidth * 69 / 1916));
    ctx.font = `500 ${fontSize}px ${SERIF}`;
    const widest = Math.max(...portfolio.reveal.lines.map(line => ctx.measureText(line).width));
    fontSize *= Math.min(1, logicalWidth * 0.85 / widest);
    ctx.font = `500 ${fontSize}px ${SERIF}`;
    const lineHeight = fontSize * 1.16;
    const firstBaseline = placement?.titleBaseline ?? (logicalHeight * 0.48 - (portfolio.reveal.lines.length - 1) * lineHeight / 2 + fontSize * 0.3);
    portfolio.reveal.lines.forEach((line, index) => ctx.fillText(line, logicalWidth / 2, firstBaseline + index * lineHeight));
    const subtitleSize = placement?.subtitleSize ?? (mobile ? 16 : Math.max(16, Math.min(24, logicalWidth * 20 / 1916)));
    ctx.font = `500 ${subtitleSize}px ${SERIF}`;
    wrapped(portfolio.reveal.description, logicalWidth / 2,
      firstBaseline + (portfolio.reveal.lines.length - 1) * lineHeight + lineHeight * 0.95,
      logicalWidth * 0.85, subtitleSize * 1.4);
    ctx.restore();
  }

  function goldenTie(options: UIOptions, mobile: boolean, scale: number) {
    const progress = clamp(options.sceneProgress ?? 0);
    const exit = clamp((progress - 0.58) / 0.31);
    ctx.save();
    const departure = clamp((progress - 0.65) / 0.15);
    ctx.globalAlpha = 1 - departure * departure * (3 - 2 * departure);
    ctx.translate(logicalWidth / 2, -exit * logicalHeight * 0.45);
    const growth = 1 + exit * 0.65;
    ctx.scale(growth, growth);
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    ctx.font = `${mobile ? 400 : 500} ${mobile ? Math.min(48, logicalWidth * 0.1231) : 100 * scale}px ${SERIF}`;
    ctx.letterSpacing = `${mobile ? 0.2 : 0.16 * scale}px`;
    if (mobile) {
      ctx.fillText("Check Out This", 0, 154);
      ctx.fillText("Golden Tie", 0, 207);
      ctx.letterSpacing = "0px";
      ctx.font = `500 22px ${SERIF}`;
      wrapped(portfolio.tie.description, 0, 247, logicalWidth * 0.74, 24);
    } else {
      ctx.fillText(portfolio.tie.title, 0, 209 * scale, logicalWidth * 0.91);
      ctx.letterSpacing = "0px";
      ctx.font = `500 ${35 * scale}px ${SERIF}`;
      ctx.fillText(portfolio.tie.description, 0, 288 * scale);
    }
    ctx.restore();
  }

  function contact(options: UIOptions) {
    const w = logicalWidth;
    const h = logicalHeight;
    const layout = contactLayout(w, h, options.sceneProgress);
    const { mobile, scale: contactScale, boxWidth, boxHeight, boxY, footerY } = layout;
    const headerHeight = navigationLayout(w, (text, font) => { ctx.font = font; return ctx.measureText(text).width; }, portfolio.home).height;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, headerHeight + 1, w, h - headerHeight);
    ctx.clip();
    ctx.save();
    ctx.translate(0, -layout.offset);
    reveal(mobile, layout);
    ctx.restore();
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = INK;
    ctx.strokeStyle = INK;
    ctx.translate(w / 2, layout.detailsTop - layout.offset);
    ctx.scale(contactScale, contactScale);
    const baseWidth = w / contactScale;
    ctx.letterSpacing = "0px";

    portfolio.contact.columns.forEach((column, index) => {
      const x = mobile ? (index === 0 ? 0 : (index === 1 ? -88 : 99)) : (index - 1) * 305;
      const y = mobile ? (index === 0 ? 0 : 115) : 0;
      ctx.font = `500 ${mobile ? 19 : 26}px ${SERIF}`;
      ctx.fillText(column.title, x, y);
      ctx.font = `500 ${mobile ? 17 : 23}px ${SERIF}`;
      column.lines.forEach((line, row) => ctx.fillText(line, x, y + (mobile ? 36 : 42) + row * (mobile ? 30 : 38), mobile ? 166 : 280));
    });

    ctx.lineWidth = mobile ? 1.5 : 2;
    ctx.setLineDash([mobile ? 5 : 10, mobile ? 5 : 10]);
    ctx.strokeRect(-boxWidth / 2, boxY, boxWidth, boxHeight);
    ctx.setLineDash([]);
    const pictureSize = mobile ? 107 : 160;
    if (portrait.complete && portrait.naturalWidth) {
      // A photographic crop of our generated fictional team, not Shader's CEO.
      const pictureHeight = mobile ? 112 : boxHeight - 24;
      ctx.drawImage(portrait, portrait.naturalWidth * 0.17, portrait.naturalHeight * 0.02, portrait.naturalWidth * 0.25, portrait.naturalHeight * 0.375, -boxWidth / 2 + 12, boxY + (boxHeight - pictureHeight) / 2, pictureSize, pictureHeight);
    }
    const textX = -boxWidth / 2 + pictureSize + (mobile ? 24 : 40);
    ctx.textAlign = "left";
    ctx.font = `600 ${mobile ? 20 : 34}px ${SERIF}`;
    wrapped(portfolio.contact.businessTitle, textX, boxY + (mobile ? 33 : 62), boxWidth - pictureSize - (mobile ? 39 : 58), mobile ? 22 : 38);
    ctx.font = `500 ${mobile ? 15 : 26}px ${SERIF}`;
    wrapped(portfolio.contact.businessDescription, textX, boxY + (mobile ? 84 : 98), boxWidth - pictureSize - (mobile ? 39 : 58), mobile ? 17 : 29);

    ctx.strokeStyle = "rgba(238,233,220,0.14)";
    ctx.beginPath();
    ctx.moveTo(-baseWidth / 2, footerY);
    ctx.lineTo(baseWidth / 2, footerY);
    ctx.stroke();
    ctx.strokeStyle = INK;
    ctx.textAlign = "center";
    const brandY = layout.brandY;
    ctx.fillStyle = INK;
    ctx.textAlign = "left";
    const markWidth = mobile ? 31 : 49, brandGap = mobile ? 10 : 17;
    const maxBrandWidth = mobile ? baseWidth * 0.86 : Math.min(baseWidth * 0.4, 520);
    let brandSize = mobile ? 29 : 43;
    ctx.font = `italic 700 ${brandSize}px ${SERIF}`;
    brandSize *= Math.min(1, (maxBrandWidth - markWidth - brandGap) / ctx.measureText(portfolio.name).width);
    ctx.font = `italic 700 ${brandSize}px ${SERIF}`;
    const brandX = -(markWidth + brandGap + ctx.measureText(portfolio.name).width) / 2;
    mark(brandX, brandY - (mobile ? 15 : 25), markWidth, mobile ? 19 : 30);
    ctx.fillStyle = INK;
    ctx.fillText(portfolio.name, brandX + markWidth + brandGap, brandY + 4);
    ctx.textAlign = "center";
    ctx.font = `italic 400 ${mobile ? 16 : 25}px ${SERIF}`;
    ctx.fillText(portfolio.contact.footerTagline, 0, brandY + (mobile ? 32 : 44));
    ctx.font = `italic 400 ${mobile ? 13 : 20}px ${SERIF}`;
    ctx.fillText(portfolio.contact.footerNotice, 0, brandY + (mobile ? 57 : 84));
    ctx.restore();
    ctx.restore();
  }

  function boot(options: UIOptions, mobile: boolean, scale: number) {
    const w = logicalWidth;
    const h = logicalHeight;
    const blue = ctx.createRadialGradient(w * 0.5, h * 0.46, 0, w * 0.5, h * 0.46, Math.max(w, h) * 0.7);
    blue.addColorStop(0, "#565195");
    blue.addColorStop(1, "#343071");
    ctx.fillStyle = blue;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = INK;
    ctx.strokeStyle = INK;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";

    if (mobile) {
      const s = Math.min(1, w / 390);
      const logoY = h * 0.359;
      const brandSize = 42*s;
      ctx.font = `italic 700 ${brandSize}px ${SERIF}`;
      const fittedSize = brandSize * Math.min(1, (w-112*s)/ctx.measureText(portfolio.home.name).width);
      ctx.font = `italic 700 ${fittedSize}px ${SERIF}`;
      const brandWidth = ctx.measureText(portfolio.home.name).width;
      const left = (w-brandWidth-66*s)/2;
      mark(left, logoY+6*s, 49*s, 29*s, true);
      ctx.fillText(portfolio.home.name, left+66*s, logoY+36*s);
      ctx.textAlign = "center";
      ctx.font = `400 ${24 * s}px ${BOOT_MONO}`;
      wrapped(portfolio.home.role, w / 2, h * 0.453, w - 42, 18 * s);
      ctx.fillText(portfolio.boot.version, w / 2, h * 0.478);
    } else {
      const brandSize = h*0.20;
      ctx.font = `italic 700 ${brandSize}px ${SERIF}`;
      const fittedSize = brandSize * Math.min(1, w*0.67/ctx.measureText(portfolio.home.name).width);
      ctx.font = `italic 700 ${fittedSize}px ${SERIF}`;
      const brandWidth = ctx.measureText(portfolio.home.name).width;
      const left = (w-brandWidth-w*0.155)/2;
      mark(left, h*0.307-fittedSize*0.66, w*0.125, fittedSize*0.60, true);
      ctx.fillText(portfolio.home.name, left+w*0.155, h*0.307);
      ctx.textAlign = "center";
      ctx.font = `400 ${logicalHeight * 0.055}px ${BOOT_MONO}`;
      ctx.fillText(portfolio.home.role, w / 2, h * 0.422);
      ctx.fillText(portfolio.boot.version, w / 2, h * 0.461);
    }

    const barWidth = mobile ? w - 70 : w * 0.426;
    const barHeight = mobile ? 30 : h * 0.073;
    const barX = (w - barWidth) / 2;
    const barY = mobile ? h * 0.542 : h * 0.652;
    ctx.lineWidth = mobile ? 1.5 : 3 * scale;
    ctx.strokeRect(barX, barY, barWidth, barHeight);
    const gap = mobile ? 4 : 7 * scale;
    const segments = 21;
    const segmentWidth = (barWidth - gap * (segments + 1)) / segments;
    const filled = Math.floor(clamp(options.bootProgress) * segments);
    for (let index = 0; index < filled; index++) {
      ctx.fillRect(barX + gap + index * (segmentWidth + gap), barY + gap, segmentWidth, barHeight - gap * 2);
    }
    ctx.textAlign = "center";
    const noticeSize = mobile ? 22 : h * 0.053;
    ctx.font = `400 ${noticeSize}px ${BOOT_MONO}`;
    if (!mobile) {
      const fittedSize = noticeSize * Math.min(1, w * 0.84 / ctx.measureText(portfolio.boot.notice).width);
      ctx.font = `400 ${fittedSize}px ${BOOT_MONO}`;
    }
    wrapped(portfolio.boot.notice, w / 2, mobile ? h * 0.87 : h * 0.923,
      w * (mobile ? 0.86 : 0.84), mobile ? 25 : h * 0.055);
  }

  function draw(options: UIOptions) {
    if (disposed) return;
    lastOptions = options;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.globalAlpha = 1;
    const mobile = logicalWidth < 900;
    const scale = Math.min(logicalWidth / 1440, logicalHeight / 900);
    if (options.mode === "boot") {
      boot(options, mobile, scale);
    } else {
      if (options.mode === "hero") hero(options, mobile, scale);
      if (options.mode === "projects" || options.mode === "project-title") projects(options, mobile, scale);
      if (options.mode === "office") office(options, mobile, scale);
      if (options.mode === "golden-tie-reveal") reveal(mobile);
      if (options.mode === "golden-tie") goldenTie(options, mobile, scale);
      if (options.mode === "contact") contact(options);
      if (options.headerVisible !== false || options.mode === "header") header(options);
    }
    texture.needsUpdate = true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    portrait.onload = null;
    portrait.src = "";
    texture.dispose();
    canvas.width = 1;
    canvas.height = 1;
  }

  resize(width, height);
  return { texture, draw, resize, dispose };
}
