async page => {
  const baseURL = new URL(page.url()).origin;
  const checks = new Map(), errors = [], failed = [], screenshots = [], holds = [], rootSamples = [];
  const stops = [
    { name: 'projects', vh: 1.42, scene: 'projects' },
    { name: 'aperture', vh: 4.7, scene: 'projects' },
    { name: 'about', vh: 7.5, scene: 'about-us' },
    { name: 'curl', vh: 12.5, scene: 'about-us' },
    { name: 'contact', vh: 13.6, extra: 100, scene: 'contact' },
  ];
  const planned = ['touch emulation is active', 'diagnostics and CSS share the story height', 'DOM sections use the story height', 'touch GPU uses controlled scrolling'];
  for (const stop of stops) {
    planned.push(`${stop.name}: hold reached`);
    for (const phase of ['toolbar hidden', 'toolbar shown']) {
      for (const property of ['scroll position', 'scene pose', 'story height', 'canvas size', 'hitboxes']) planned.push(`${stop.name}: ${phase} preserves ${property}`);
    }
  }
  for (const area of ['about', 'aperture', 'curl']) {
    planned.push(`${area}: forward controlled swipe`, `${area}: reverse controlled swipe`);
  }
  planned.push('hero swipe still enters projects', 'projects swipe still returns to hero', 'contact footer is reachable', 'contact has no horizontal overflow');
  for (const orientation of ['landscape', 'portrait']) {
    planned.push(`${orientation}: story position preserved`, `${orientation}: scene pose preserved`, `${orientation}: one mobile canvas remains`);
  }
  planned.push('tall initial viewport uses its own story height', 'tall initial viewport shrink preserves the contact pose',
    'tall initial viewport keeps its canvas and hitboxes fixed', 'tall initial viewport reaches the complete footer');
  planned.push('controlled mobile stages never move or overflow the document', 'reduced motion keeps controlled scrolling without animation', 'GPU fallback restores native scrolling');
  planned.push('no page errors or failed assets', 'all planned stages completed');
  const check = (name, pass, detail) => checks.set(name, { name, pass: Boolean(pass), detail });
  const onPageError = error => errors.push(error.message);
  const onResponse = response => { if (response.status() >= 400 && response.url().startsWith(baseURL)) failed.push({ url: response.url(), status: response.status() }); };
  const emulation = await page.context().newCDPSession(page);
  const originalAgent = await page.evaluate(() => navigator.userAgent);
  let completed = false;
  page.on('pageerror', onPageError);
  page.on('response', onResponse);
  const metrics = async (width, height) => {
    // Screenshot capture restores Playwright's viewport, so keep it aligned
    // with CDP. Otherwise a capture silently injects a desktop-width resize.
    await page.setViewportSize({ width, height });
    await emulation.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 3, mobile: true,
      screenOrientation: { type: width > height ? 'landscapePrimary' : 'portraitPrimary', angle: width > height ? 90 : 0 },
    });
  };
  const snapshot = async (auditRoot = true) => {
    const state = await page.evaluate(() => {
    const diagnostics = window.__sceneDiagnostics;
    const experience = document.querySelector('.experience');
    const cssHeight = parseFloat(getComputedStyle(experience).getPropertyValue('--story-viewport-height'));
    const storyHeight = diagnostics?.storyHeight;
    const canvas = document.querySelector('.scene-canvas canvas')?.getBoundingClientRect();
    const hitboxes = [...document.querySelectorAll('.hero-scroll-control,.project-controls button,[data-project-link],[data-contact-action]')].map(element => {
      const rect = element.getBoundingClientRect();
      return { id: element.getAttribute('data-project-link') ?? element.getAttribute('data-contact-action') ?? element.getAttribute('aria-label') ?? element.className,
        x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    return {
      scrollY, width: innerWidth, height: innerHeight,
      documentHeight: document.documentElement.scrollHeight,
      rootOverflow: getComputedStyle(document.documentElement).overflowY,
      scrollPosition: diagnostics?.scrollPosition, scrollMode: diagnostics?.scrollMode,
      sceneHeight: diagnostics?.sceneHeight, scrollLimit: diagnostics?.scrollLimit,
      storyHeight: Number.isFinite(storyHeight) ? storyHeight : null,
      cssHeight: Number.isFinite(cssHeight) ? cssHeight : null,
      scene: diagnostics?.scene, localProgress: diagnostics?.localProgress,
      projectExit: diagnostics?.projectExit, frames: diagnostics?.frames,
      passes: diagnostics?.passes, model: diagnostics?.computer?.textureQuality, videoPaused: diagnostics?.heroReel?.paused,
      canvasCount: document.querySelectorAll('.scene-canvas canvas').length,
      canvas: canvas ? { x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height } : null,
      hitboxes,
    };
    });
    if (auditRoot) rootSamples.push(state);
    return state;
  };
  const screenshot = async name => {
    const path = `artifacts/mobile-viewport-${name}.png`;
    await page.screenshot({ path });
    screenshots.push(path);
  };
  // Drive the application's scroll owner so earlier touch latches and Lenis targets
  // cannot contaminate the next independent hold. Clamping at Contact is recorded.
  const hold = async (vh, extra = 0) => {
    const state = await snapshot();
    if (!(state.storyHeight > 0)) throw new Error('The scroll owner did not publish a valid storyHeight.');
    const requested = vh * state.storyHeight + extra;
    await page.evaluate(top => window.dispatchEvent(new CustomEvent('study-navigate', { detail: top })), requested);
    await page.waitForTimeout(1300);
    return { ...await snapshot(), requested };
  };
  const samePose = (a, b, tolerance = 0.0005) => a.scene === b.scene
    && Number.isFinite(a.localProgress) && Number.isFinite(b.localProgress)
    && Math.abs(a.localProgress - b.localProgress) <= tolerance
    && Number.isFinite(a.projectExit) && Number.isFinite(b.projectExit)
    && Math.abs(a.projectExit - b.projectExit) <= tolerance;
  const sameRect = (a, b) => a && b && ['x', 'y', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) < 0.5);
  const sameCanvas = (a, b) => a.sceneHeight > 0 && a.sceneHeight === b.sceneHeight
    && Math.abs(a.canvas?.height - a.sceneHeight) < 0.5 && sameRect(a.canvas, b.canvas);
  const sameHitboxes = (a, b) => a.hitboxes.length > 0 && a.hitboxes.length === b.hitboxes.length
    && a.hitboxes.every((box, index) => box.id === b.hitboxes[index].id && sameRect(box, b.hitboxes[index]));
  const rootLocked = state => state.scrollMode === 'controlled' && state.scrollY === 0 && state.documentHeight <= state.height;
  // Root scroll must remain locked during animation and touch movement as well as
  // at the final snapshots. Keep only violations to avoid a huge evidence payload.
  const audits = [];
  const startRootAudit = () => page.evaluate(() => {
    const audit = { active: true, samples: 0, violations: [] };
    window.__mobileViewportLockAudit = audit;
    const sample = () => {
      if (!audit.active) return;
      audit.samples++;
      if (window.__sceneDiagnostics?.scrollMode !== 'controlled' || scrollY !== 0 || document.documentElement.scrollHeight > innerHeight) {
        if (audit.violations.length < 20) audit.violations.push({ scrollY, height: innerHeight, documentHeight: document.documentElement.scrollHeight, mode: window.__sceneDiagnostics?.scrollMode });
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const finishRootAudit = async () => {
    const audit = await page.evaluate(() => {
      const audit = window.__mobileViewportLockAudit;
      if (audit) audit.active = false;
      return audit ?? null;
    });
    if (audit) audits.push(audit);
  };
  const swipe = async (from, to) => {
    await emulation.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 220, y: from }] });
    for (let step = 1; step <= 8; step++) {
      await emulation.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 220, y: from + (to - from) * step / 8 }] });
      await page.waitForTimeout(35);
    }
    // Pause before release to keep resize comparisons independent of momentum.
    await page.waitForTimeout(140);
    await emulation.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(1900);
  };
  try {
    await page.bringToFront();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await metrics(440, 820);
    await emulation.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await emulation.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
    await page.goto(baseURL + '/?renderer=webgl');
    await page.waitForFunction(() => document.querySelector('.is-ready') && window.__sceneDiagnostics?.intro === 1, null, { timeout: 120000 });
    const device = await page.evaluate(() => ({ coarse: matchMedia('(pointer:coarse)').matches, touches: navigator.maxTouchPoints, dpr: devicePixelRatio }));
    check('touch emulation is active', device.coarse && device.touches > 0 && device.dpr === 3, device);
    const initial = await snapshot();
    await startRootAudit();
    check('touch GPU uses controlled scrolling', rootLocked(initial) && Number.isFinite(initial.scrollPosition)
      && initial.sceneHeight > 0 && Math.abs(initial.canvas?.height - initial.sceneHeight) < 0.5, initial);
    check('diagnostics and CSS share the story height', initial.storyHeight > 0 && Math.abs(initial.storyHeight - initial.cssHeight) < 0.01, initial);
    const sections = await page.evaluate(() => ['hero', 'projects', 'about-us'].map(id => ({ id, height: document.getElementById(id).getBoundingClientRect().height })));
    check('DOM sections use the story height', sections.every((section, index) => Math.abs(section.height - [1.4, 4.2, 8][index] * (initial.storyHeight ?? 0)) < 1), sections);

    for (const stop of stops) {
      await metrics(440, 820);
      await page.waitForTimeout(650);
      const before = await hold(stop.vh, stop.extra);
      check(`${stop.name}: hold reached`, before.scene === stop.scene
        && Number.isFinite(before.scrollPosition) && Number.isFinite(before.scrollLimit)
        && Math.abs(before.scrollPosition - Math.min(before.requested, before.scrollLimit)) <= 2
        && (stop.name !== 'aperture' || (before.projectExit > 0 && before.projectExit < 1))
        && (stop.name !== 'curl' || before.passes?.includes('intact-page-curl')), before);
      await screenshot(`${stop.name}-before`);
      for (const [phase, height] of [['toolbar hidden', 932], ['toolbar shown', 820]]) {
        await metrics(440, height);
        // Sample both before and after the old 150ms/250ms resize callbacks.
        const samples = [];
        for (const delay of [0, 80, 140, 330, 450]) {
          if (delay) await page.waitForTimeout(delay);
          samples.push(await snapshot());
        }
        const detail = { before, samples };
        check(`${stop.name}: ${phase} preserves scroll position`, samples.every(sample => Math.abs(sample.scrollPosition - before.scrollPosition) <= 2), detail);
        check(`${stop.name}: ${phase} preserves scene pose`, samples.every(sample => samePose(before, sample)), detail);
        check(`${stop.name}: ${phase} preserves story height`, samples.every(sample => sample.storyHeight > 0
          && sample.storyHeight === before.storyHeight && Math.abs(sample.cssHeight - before.storyHeight) < 0.01), detail);
        check(`${stop.name}: ${phase} preserves canvas size`, samples.every(sample => sameCanvas(before, sample)), detail);
        check(`${stop.name}: ${phase} preserves hitboxes`, samples.every(sample => sameHitboxes(before, sample)), detail);
        holds.push({ stop: stop.name, phase, ...detail });
        await screenshot(`${stop.name}-${height}`);
      }
    }

    for (const stop of [stops[2], stops[1], stops[3]]) {
      const before = await hold(stop.vh);
      await swipe(650, 490);
      const forward = await snapshot();
      check(`${stop.name}: forward controlled swipe`, forward.scrollPosition > before.scrollPosition + 20 && forward.scene === stop.scene, { before, forward });
      await swipe(490, 650);
      const reverse = await snapshot();
      check(`${stop.name}: reverse controlled swipe`, reverse.scrollPosition < forward.scrollPosition - 20 && reverse.scene === stop.scene, { forward, reverse });
    }
    await hold(0);
    await swipe(680, 410);
    const entered = await snapshot();
    check('hero swipe still enters projects', entered.scene === 'projects' && Math.abs(entered.scrollPosition / entered.storyHeight - 1.42) < 0.01, entered);
    await swipe(410, 680);
    const returned = await snapshot();
    check('projects swipe still returns to hero', returned.scene === 'hero' && returned.scrollPosition < 2, returned);

    await hold(13.6);
    await swipe(680, 390);
    const footer = await snapshot();
    const end = await hold(100);
    check('contact footer is reachable', footer.scene === 'contact' && Number.isFinite(footer.scrollLimit)
      && Math.abs(footer.scrollLimit - footer.scrollPosition) <= 2 && Math.abs(end.scrollPosition - footer.scrollPosition) <= 2
      && footer.passes?.includes('contact'), { footer, end });
    check('contact has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await screenshot('contact-footer');

    const portrait = await hold(7.5);
    const normalized = portrait.scrollPosition / portrait.storyHeight;
    for (const [orientation, width, height] of [['landscape', 956, 440], ['portrait', 440, 820]]) {
      await metrics(width, height);
      await page.waitForTimeout(1100);
      const after = await snapshot();
      check(`${orientation}: story position preserved`, after.storyHeight > 0
        && Math.abs(after.scrollPosition / after.storyHeight - normalized) < 0.005, { portrait, after });
      check(`${orientation}: scene pose preserved`, samePose(portrait, after, 0.001), { portrait, after });
      check(`${orientation}: one mobile canvas remains`, after.canvasCount === 1 && after.model === 'mobile', after);
      await screenshot(orientation);
    }

    // A page may open with browser chrome hidden. The first toolbar reveal must
    // preserve the original render surface and its controls without root overflow.
    await finishRootAudit();
    await metrics(440, 932);
    await page.goto(baseURL + '/?renderer=webgl');
    await page.waitForFunction(() => document.querySelector('.is-ready') && window.__sceneDiagnostics?.intro === 1, null, { timeout: 120000 });
    const tallInitial = await snapshot();
    await startRootAudit();
    check('tall initial viewport uses its own story height', tallInitial.height === 932
      && tallInitial.storyHeight === 932 && tallInitial.cssHeight === 932, tallInitial);
    const tallContact = await hold(13.6);
    await metrics(440, 820);
    await page.waitForTimeout(1100);
    const shortened = await snapshot();
    check('tall initial viewport shrink preserves the contact pose', shortened.storyHeight === tallContact.storyHeight
      && Math.abs(shortened.scrollPosition - tallContact.scrollPosition) <= 2 && samePose(tallContact, shortened), { tallContact, shortened });
    check('tall initial viewport keeps its canvas and hitboxes fixed', sameCanvas(tallContact, shortened)
      && sameHitboxes(tallContact, shortened) && rootLocked(shortened), { tallContact, shortened });
    await swipe(680, 390);
    const tallFooter = await snapshot();
    const tallEnd = await hold(100);
    check('tall initial viewport reaches the complete footer', tallFooter.scene === 'contact'
      && Math.abs(tallFooter.scrollPosition - tallEnd.scrollPosition) <= 2
      && Math.abs(tallFooter.scrollLimit - tallFooter.scrollPosition) <= 2
      && tallFooter.scrollLimit > 13.6 * tallFooter.storyHeight + 20
      && tallFooter.passes?.includes('contact') && rootLocked(tallFooter), { tallFooter, tallEnd });
    await screenshot('initial-tall-contact-footer');
    await finishRootAudit();
    check('controlled mobile stages never move or overflow the document', rootSamples.length > 0
      && rootSamples.every(rootLocked) && audits.length === 2 && audits.every(audit => audit.samples > 0 && audit.violations.length === 0),
    { snapshotCount: rootSamples.length, violations: rootSamples.filter(state => !rootLocked(state)), audits });

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(baseURL + '/?renderer=webgl');
    await page.waitForFunction(() => document.querySelector('.is-ready') && window.__sceneDiagnostics?.intro === 1, null, { timeout: 120000 });
    const reducedBefore = await snapshot(false);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('study-navigate', { detail: 7.5 * window.__sceneDiagnostics.storyHeight })));
    await page.waitForFunction(() => Math.abs(window.__sceneDiagnostics.scrollPosition - 7.5 * window.__sceneDiagnostics.storyHeight) < 2, null, { timeout: 500 });
    const reducedAfter = await snapshot(false);
    check('reduced motion keeps controlled scrolling without animation', rootLocked(reducedBefore) && rootLocked(reducedAfter)
      && reducedAfter.scene === 'about-us' && reducedAfter.scrollPosition > reducedBefore.scrollPosition + 20
      && reducedAfter.videoPaused === true, { reducedBefore, reducedAfter });

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(baseURL + '/?renderer=none');
    await page.waitForSelector('.is-fallback', { timeout: 30000 });
    const fallbackBefore = await snapshot(false);
    await swipe(650, 450);
    const fallbackAfter = await snapshot(false);
    check('GPU fallback restores native scrolling', fallbackAfter.canvasCount === 0
      && fallbackAfter.documentHeight > fallbackAfter.height && !['hidden', 'clip'].includes(fallbackAfter.rootOverflow)
      && fallbackAfter.scrollY > fallbackBefore.scrollY + 20, { fallbackBefore, fallbackAfter });
    completed = true;
  } catch (error) {
    errors.push(`Automation: ${String(error)}`);
    try { await screenshot('failure'); } catch (captureError) { errors.push(`Screenshot: ${String(captureError)}`); }
  } finally {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    page.off('pageerror', onPageError);
    page.off('response', onResponse);
    try {
      await page.evaluate(() => { if (window.__mobileViewportLockAudit) window.__mobileViewportLockAudit.active = false; });
      await emulation.send('Emulation.clearDeviceMetricsOverride');
      await emulation.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await emulation.send('Emulation.setUserAgentOverride', { userAgent: originalAgent });
    } catch (error) { errors.push(`Emulation cleanup: ${String(error)}`); }
    await emulation.detach();
  }
  check('no page errors or failed assets', errors.length === 0 && failed.length === 0, { errors, failed });
  check('all planned stages completed', completed, { expected: planned.length, executed: checks.size + 1 });
  const results = planned.map(name => checks.get(name) ?? { name, pass: false, detail: 'Not reached because an earlier automation stage failed.' });
  return {
    engine: 'Windows Chromium CDP touch/DPR and height emulation; not a physical iOS Safari toolbar test',
    completed, expected: planned.length, passed: results.filter(result => result.pass).length,
    total: results.length, checks: results, errors, failed, screenshots, holds,
  };
}
