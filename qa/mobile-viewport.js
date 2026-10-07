async page => {
  const baseURL = new URL(page.url()).origin;
  const checks = new Map(), errors = [], failed = [], screenshots = [], holds = [];
  const stops = [
    { name: 'projects', vh: 1.42, scene: 'projects' },
    { name: 'aperture', vh: 4.7, scene: 'projects' },
    { name: 'about', vh: 7.5, scene: 'about-us' },
    { name: 'curl', vh: 12.5, scene: 'about-us' },
    { name: 'contact', vh: 13.6, extra: 100, scene: 'contact' },
  ];
  const planned = ['touch emulation is active', 'diagnostics and CSS share the story height', 'DOM sections use the story height'];
  for (const stop of stops) {
    planned.push(`${stop.name}: hold reached`);
    for (const phase of ['toolbar hidden', 'toolbar shown']) {
      for (const property of ['scroll position', 'scene pose', 'story height']) planned.push(`${stop.name}: ${phase} preserves ${property}`);
    }
  }
  for (const area of ['about', 'aperture', 'curl']) {
    planned.push(`${area}: forward native swipe`, `${area}: reverse native swipe`);
  }
  planned.push('hero swipe still enters projects', 'projects swipe still returns to hero', 'contact footer is reachable', 'contact has no horizontal overflow');
  for (const orientation of ['landscape', 'portrait']) {
    planned.push(`${orientation}: story position preserved`, `${orientation}: scene pose preserved`, `${orientation}: one mobile canvas remains`);
  }
  planned.push('tall initial viewport uses its own story height', 'tall initial viewport shrink preserves the contact pose',
    'tall initial viewport reserves newly required contact overflow', 'tall initial viewport reaches the complete footer');
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
  const snapshot = () => page.evaluate(() => {
    const diagnostics = window.__sceneDiagnostics;
    const experience = document.querySelector('.experience');
    const cssHeight = parseFloat(getComputedStyle(experience).getPropertyValue('--story-viewport-height'));
    const storyHeight = diagnostics?.storyHeight;
    return {
      scrollY, width: innerWidth, height: innerHeight,
      maxScroll: Math.max(0, document.documentElement.scrollHeight - innerHeight),
      storyHeight: Number.isFinite(storyHeight) ? storyHeight : null,
      cssHeight: Number.isFinite(cssHeight) ? cssHeight : null,
      scene: diagnostics?.scene, localProgress: diagnostics?.localProgress,
      projectExit: diagnostics?.projectExit, frames: diagnostics?.frames,
      passes: diagnostics?.passes, model: diagnostics?.computer.textureQuality,
      canvasCount: document.querySelectorAll('.scene-canvas canvas').length,
    };
  });
  const screenshot = async name => {
    const path = `artifacts/mobile-viewport-${name}.png`;
    await page.screenshot({ path });
    screenshots.push(path);
  };
  // Drive the application's scroll owner so earlier touch latches and Lenis targets
  // cannot contaminate the next independent hold. Clamping at Contact is recorded.
  const hold = async (vh, extra = 0) => {
    const state = await snapshot();
    const basis = state.storyHeight ?? state.cssHeight ?? state.height;
    const requested = vh * basis + extra;
    await page.evaluate(top => window.dispatchEvent(new CustomEvent('study-navigate', { detail: top })), requested);
    await page.waitForTimeout(1650);
    return { ...await snapshot(), requested };
  };
  const samePose = (a, b, tolerance = 0.0005) => a.scene === b.scene
    && Number.isFinite(a.localProgress) && Number.isFinite(b.localProgress)
    && Math.abs(a.localProgress - b.localProgress) <= tolerance
    && Number.isFinite(a.projectExit) && Number.isFinite(b.projectExit)
    && Math.abs(a.projectExit - b.projectExit) <= tolerance;
  const swipe = async (from, to) => {
    await emulation.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 220, y: from }] });
    for (let step = 1; step <= 8; step++) {
      await emulation.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 220, y: from + (to - from) * step / 8 }] });
      await page.waitForTimeout(35);
    }
    // Pause before release to avoid comparing an idle resize with native inertia.
    await page.waitForTimeout(140);
    await emulation.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(1900);
  };
  try {
    await page.bringToFront();
    await metrics(440, 820);
    await emulation.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await emulation.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
    await page.goto(baseURL + '/?renderer=webgl');
    await page.waitForFunction(() => document.querySelector('.is-ready') && window.__sceneDiagnostics?.intro === 1, null, { timeout: 120000 });
    const device = await page.evaluate(() => ({ coarse: matchMedia('(pointer:coarse)').matches, touches: navigator.maxTouchPoints, dpr: devicePixelRatio }));
    check('touch emulation is active', device.coarse && device.touches > 0 && device.dpr === 3, device);
    const initial = await snapshot();
    check('diagnostics and CSS share the story height', initial.storyHeight > 0 && Math.abs(initial.storyHeight - initial.cssHeight) < 0.01, initial);
    const sections = await page.evaluate(() => ['hero', 'projects', 'about-us'].map(id => ({ id, height: document.getElementById(id).getBoundingClientRect().height })));
    check('DOM sections use the story height', sections.every((section, index) => Math.abs(section.height - [1.4, 4.2, 8][index] * (initial.storyHeight ?? 0)) < 1), sections);

    for (const stop of stops) {
      await metrics(440, 820);
      await page.waitForTimeout(650);
      const before = await hold(stop.vh, stop.extra);
      check(`${stop.name}: hold reached`, before.scene === stop.scene
        && Math.abs(before.scrollY - Math.min(before.requested, before.maxScroll)) <= 2
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
        check(`${stop.name}: ${phase} preserves scroll position`, samples.every(sample => Math.abs(sample.scrollY - before.scrollY) <= 2), detail);
        check(`${stop.name}: ${phase} preserves scene pose`, samples.every(sample => samePose(before, sample)), detail);
        check(`${stop.name}: ${phase} preserves story height`, samples.every(sample => sample.storyHeight > 0
          && sample.storyHeight === before.storyHeight && Math.abs(sample.cssHeight - before.storyHeight) < 0.01), detail);
        holds.push({ stop: stop.name, phase, ...detail });
        await screenshot(`${stop.name}-${height}`);
      }
    }

    for (const stop of [stops[2], stops[1], stops[3]]) {
      const before = await hold(stop.vh);
      await swipe(650, 490);
      const forward = await snapshot();
      check(`${stop.name}: forward native swipe`, forward.scrollY > before.scrollY + 20 && forward.scene === stop.scene, { before, forward });
      await swipe(490, 650);
      const reverse = await snapshot();
      check(`${stop.name}: reverse native swipe`, reverse.scrollY < forward.scrollY - 20 && reverse.scene === stop.scene, { forward, reverse });
    }
    await hold(0);
    await swipe(680, 410);
    const entered = await snapshot();
    check('hero swipe still enters projects', entered.scene === 'projects' && Math.abs(entered.scrollY / (entered.storyHeight ?? entered.height) - 1.42) < 0.01, entered);
    await swipe(410, 680);
    const returned = await snapshot();
    check('projects swipe still returns to hero', returned.scene === 'hero' && returned.scrollY < 2, returned);

    await hold(13.6);
    await swipe(680, 390);
    const footer = await snapshot();
    check('contact footer is reachable', footer.scene === 'contact' && Math.abs(footer.maxScroll - footer.scrollY) <= 2 && footer.passes?.includes('contact'), footer);
    check('contact has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await screenshot('contact-footer');

    const portrait = await hold(7.5);
    const normalized = portrait.scrollY / (portrait.storyHeight ?? portrait.height);
    for (const [orientation, width, height] of [['landscape', 956, 440], ['portrait', 440, 820]]) {
      await metrics(width, height);
      await page.waitForTimeout(1100);
      const after = await snapshot();
      check(`${orientation}: story position preserved`, after.storyHeight > 0
        && Math.abs(after.scrollY / after.storyHeight - normalized) < 0.005, { portrait, after });
      check(`${orientation}: scene pose preserved`, samePose(portrait, after, 0.001), { portrait, after });
      check(`${orientation}: one mobile canvas remains`, after.canvasCount === 1 && after.model === 'mobile', after);
      await screenshot(orientation);
    }

    // A page may open while browser chrome is hidden. The first toolbar reveal
    // must create enough Contact travel without moving its existing scroll pose.
    await metrics(440, 932);
    await page.goto(baseURL + '/?renderer=webgl');
    await page.waitForFunction(() => document.querySelector('.is-ready') && window.__sceneDiagnostics?.intro === 1, null, { timeout: 120000 });
    const tallInitial = await snapshot();
    check('tall initial viewport uses its own story height', tallInitial.height === 932
      && tallInitial.storyHeight === 932 && tallInitial.cssHeight === 932, tallInitial);
    const tallContact = await hold(13.6, 2);
    await metrics(440, 820);
    await page.waitForTimeout(1100);
    const shortened = await snapshot();
    check('tall initial viewport shrink preserves the contact pose', shortened.storyHeight === tallContact.storyHeight
      && Math.abs(shortened.scrollY - tallContact.scrollY) <= 2 && samePose(tallContact, shortened), { tallContact, shortened });
    const contactRange = await page.evaluate(() => {
      const top = document.getElementById('contact').getBoundingClientRect().top + scrollY;
      return { top, available: document.documentElement.scrollHeight - innerHeight - top };
    });
    // At 440px wide the authored Contact composition ends at y=850. A visible
    // height of 820 therefore needs 30px, even if its initial 932px view needed 0.
    check('tall initial viewport reserves newly required contact overflow', contactRange.available >= 29, { contactRange, shortened });
    await swipe(680, 390);
    const tallFooter = await snapshot();
    check('tall initial viewport reaches the complete footer', tallFooter.scene === 'contact'
      && Math.abs(tallFooter.scrollY - tallFooter.maxScroll) <= 2
      && tallFooter.scrollY - contactRange.top >= 29 && tallFooter.passes?.includes('contact'), { contactRange, tallFooter });
    await screenshot('initial-tall-contact-footer');
    completed = true;
  } catch (error) {
    errors.push(`Automation: ${String(error)}`);
    try { await screenshot('failure'); } catch (captureError) { errors.push(`Screenshot: ${String(captureError)}`); }
  } finally {
    page.off('pageerror', onPageError);
    page.off('response', onResponse);
    try {
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
