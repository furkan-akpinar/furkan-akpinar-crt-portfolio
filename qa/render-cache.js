async page => {
  const origin = new URL(page.url()).origin;
  const originalViewport = page.viewportSize();
  const checks = [], errors = [], failed = [];
  const expected = 18;
  let completed = false;
  const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail });
  const onError = error => errors.push(error.message);
  const onResponse = response => {
    if (response.url().startsWith(origin + '/') && response.status() >= 400) failed.push({ url: response.url(), status: response.status() });
  };
  page.on('pageerror', onError);
  page.on('response', onResponse);
  const snapshot = () => page.evaluate(() => {
    const d = window.__sceneDiagnostics;
    return {
      scene: d.scene, frames: d.frames, work: { ...d.renderWork },
      wave: { ...d.projectTitle }, activeIndex: d.ring.activeIndex,
      projectMotion: d.projectMotion, travel: d.travel, signal: { ...d.menuSignal },
      contentReady: d.contentReady, intro: d.intro,
    };
  });
  const delta = (a, b) => ({ frames: b.frames - a.frames,
    projects: b.work.projects - a.work.projects, bloom: b.work.bloom - a.work.bloom,
    hero: b.work.hero - a.work.hero, wave: b.wave.phase - a.wave.phase });
  const ready = async (width, height) => {
    await page.setViewportSize({ width, height });
    await page.goto(origin + '/?renderer=webgl');
    await page.waitForFunction(() => window.__sceneDiagnostics?.contentReady && window.__sceneDiagnostics.intro === 1,
      null, { timeout: 120000 });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('study-navigate', {
      detail: 1.42 * window.__sceneDiagnostics.storyHeight,
    })));
    await page.waitForFunction(() => window.__sceneDiagnostics?.scene === 'projects'
      && window.__sceneDiagnostics.travel === 1 && window.__sceneDiagnostics.projectMotion === 1,
    null, { timeout: 20000 });
    await page.mouse.move(width - 5, Math.round(height / 2));
    await page.waitForTimeout(1500);
  };
  try {
    await page.bringToFront();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await ready(1440, 900);
    const desktopStart = await snapshot();
    const pixelsBefore = await page.locator('.scene-canvas canvas').screenshot();
    await page.waitForTimeout(450);
    const pixelsAfter = await page.locator('.scene-canvas canvas').screenshot();
    const desktopEnd = await snapshot();
    const desktop = delta(desktopStart, desktopEnd);
    check('desktop: stationary film reuses its render and bloom', desktop.projects <= 1 && desktop.bloom <= 1, desktop);
    check('desktop: final composite keeps drawing while the film is cached', desktop.frames >= 4, desktop);
    check('desktop: visible CRT grain still changes between cached frames', !pixelsBefore.equals(pixelsAfter));
    check('desktop: the static title remains still', !desktopEnd.wave.enabled && desktop.wave === 0, desktop);

    const beforeSelection = await snapshot();
    const nextIndex = (beforeSelection.activeIndex + 1) % 7;
    await page.getByRole('button', { name: 'Sonraki proje', exact: true }).click();
    await page.waitForFunction(() => window.__sceneDiagnostics.projectMotion > 0 && window.__sceneDiagnostics.projectMotion < 1,
      null, { timeout: 10000 });
    const duringSelection = await snapshot();
    await page.waitForFunction(index => window.__sceneDiagnostics.projectMotion === 1 && window.__sceneDiagnostics.ring.activeIndex === index,
      nextIndex, { timeout: 20000 });
    const afterSelection = await snapshot();
    const selection = delta(beforeSelection, afterSelection);
    check('desktop: a real project change invalidates cached film and bloom', selection.projects > 1 && selection.bloom > 1, selection);
    check('desktop: selection animates and reaches the requested poster', duringSelection.projectMotion < 1 && afterSelection.activeIndex === nextIndex, { duringSelection, afterSelection });
    await page.waitForTimeout(300);
    const settledStart = await snapshot();
    await page.waitForTimeout(450);
    const settled = delta(settledStart, await snapshot());
    check('desktop: cache resumes after the project movement settles', settled.projects <= 1 && settled.bloom <= 1 && settled.frames >= 4, settled);

    await page.locator('#section-navigation').getByRole('button', { name: 'Hakkımda', exact: true }).click();
    await page.waitForFunction(() => window.__sceneDiagnostics.menuSignal.active, null, { timeout: 10000 });
    const signal = await page.evaluate(async () => {
      const samples = [], start = performance.now();
      await new Promise(resolve => {
        const frame = () => {
          const d = window.__sceneDiagnostics;
          samples.push({ frame: d.frames, active: d.menuSignal.active, progress: d.menuSignal.progress, drawn: d.passes.includes('menu-signal') });
          if (performance.now() - start < 450) requestAnimationFrame(frame); else resolve();
        };
        requestAnimationFrame(frame);
      });
      return samples;
    });
    const active = signal.filter(item => item.active);
    check('desktop: menu signal advances instead of freezing on a cached project', active.length > 2
      && new Set(active.map(item => item.progress)).size > 2 && active.some(item => item.drawn), signal);
    await page.waitForFunction(() => window.__sceneDiagnostics.scene === 'about-us' && !window.__sceneDiagnostics.menuSignal.active,
      null, { timeout: 20000 });
    check('desktop: signal completes into the requested ready destination', (await snapshot()).contentReady);

    await ready(390, 844);
    const mobileStart = await snapshot();
    await page.waitForTimeout(450);
    const mobileEnd = await snapshot(), mobile = delta(mobileStart, mobileEnd);
    check('mobile: responsive title wave keeps moving', mobileEnd.wave.enabled && mobile.wave > 0, mobile);
    check('mobile: animated title refreshes film and bloom', mobile.projects >= 4 && mobile.bloom >= 4, mobile);
    check('mobile: scene stays settled while its subtle animation runs', mobileEnd.scene === 'projects'
      && mobileEnd.travel === 1 && mobileEnd.projectMotion === 1 && mobileEnd.activeIndex === mobileStart.activeIndex, mobileEnd);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await ready(390, 844);
    const reducedStart = await snapshot();
    await page.waitForTimeout(450);
    const reducedEnd = await snapshot(), reduced = delta(reducedStart, reducedEnd);
    check('reduced motion: responsive title wave is disabled', !reducedEnd.wave.enabled && reduced.wave === 0, reduced);
    check('reduced motion: stationary mobile film and bloom can be reused', reduced.projects <= 1 && reduced.bloom <= 1, reduced);
    check('reduced motion: final output remains responsive', reduced.frames >= 4, reduced);
    check('one persistent scene canvas remains', await page.locator('.scene-canvas canvas').count() === 1);
    check('no unexpected browser errors or failed assets', errors.length === 0 && failed.length === 0, { errors, failed });
    completed = true;
    check('all cache behavior stages completed', true);
  } catch (error) {
    check('all cache behavior stages completed', false, String(error));
  } finally {
    page.off('pageerror', onError);
    page.off('response', onResponse);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
  return { completed, expected, passed: checks.filter(item => item.pass).length,
    total: Math.max(expected, checks.length), checks, errors, failed };
}
