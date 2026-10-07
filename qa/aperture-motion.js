async page => {
  const baseURL = new URL(page.url()).origin;
  const originalViewport = page.viewportSize();
  const progressSamples = [0, .125, .25, .375, .5, .625, .75, .875, .98];
  const visualFields = ['radius', 'exposure', 'glow', 'centerX', 'centerY', 'phase7', 'phase13', 'clock'];
  const mobileChecks = ['responsive aperture selected', 'sampled progress and visibility match navigation',
    'all visual uniforms are finite', 'opening radius grows monotonically', 'held poses stay completely stationary',
    'rewinding restores the same poses', 'Projects and About endpoints disable the aperture'];
  const planned = [
    ...[390, 768].flatMap(width => mobileChecks.map(name => `${width}: ${name}`)),
    'desktop retains its aperture mode', 'desktop edge clock continues at a held midpoint',
    'desktop midpoint radius retains its original value', 'reduced motion disables the aperture and its clock',
    'reduced motion retains the requested scene position', 'no page errors or failed same-origin assets',
    'all planned aperture stages completed',
  ];
  const checks = new Map(), errors = [], failed = [], screenshots = [], samples = [];
  let completed = false;
  const check = (name, pass, detail) => checks.set(name, { name, pass: Boolean(pass), detail });
  const onPageError = error => errors.push(error.message);
  const onResponse = response => {
    if (response.status() >= 400 && response.url().startsWith(baseURL + '/')) {
      failed.push({ url: response.url(), status: response.status() });
    }
  };
  page.on('pageerror', onPageError);
  page.on('response', onResponse);
  const snapshot = () => page.evaluate(() => ({
    aperture: window.__sceneDiagnostics?.aperture,
    scene: window.__sceneDiagnostics?.scene,
    position: window.__sceneDiagnostics?.scrollPosition,
    storyHeight: window.__sceneDiagnostics?.storyHeight,
    canvases: document.querySelectorAll('.scene-canvas canvas').length,
    overflow: document.documentElement.scrollWidth > innerWidth,
  }));
  const samePose = (a, b) => a?.enabled === b?.enabled
    && visualFields.every(field => Number.isFinite(a?.[field]) && Math.abs(a[field] - b?.[field]) < 1e-8);
  const ready = async (width, height) => {
    await page.setViewportSize({ width, height });
    await page.goto(baseURL + '/?renderer=webgl');
    await page.waitForFunction(() => document.querySelector('.is-ready')
      && window.__sceneDiagnostics?.intro === 1 && window.__sceneDiagnostics?.aperture,
    null, { timeout: 120000 });
  };
  const navigate = async progress => {
    const vh = 1.42 + (5.6 - 1.42) * progress;
    const target = await page.evaluate(({ vh, progress }) => {
      const top = vh * window.__sceneDiagnostics.storyHeight;
      // The About boundary must survive integer native-scroll rounding.
      const target = progress === 1 ? Math.ceil(top) + 2 : top;
      window.dispatchEvent(new CustomEvent('study-navigate', { detail: target }));
      return target;
    }, { vh, progress });
    // Navigation itself takes 1.15 s; sample only after its final frame.
    await page.waitForTimeout(1300);
    await page.waitForFunction(target => Math.abs(window.__sceneDiagnostics.scrollPosition
      - target) < 1, target, { timeout: 15000 });
    return snapshot();
  };

  try {
    await page.bringToFront();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    for (const [width, height] of [[390, 844], [768, 1024]]) {
      await ready(width, height);
      const forward = [], held = [], reverse = [];
      for (const progress of progressSamples) {
        const state = await navigate(progress);
        forward.push({ progress, ...state });
        await page.waitForTimeout(500);
        held.push(await snapshot());
        if ([.25, .5, .75, .875].includes(progress)) {
          const path = `artifacts/aperture-motion-${width}-p${progress * 100}.png`;
          await page.screenshot({ path });
          screenshots.push(path);
        }
      }
      for (const progress of [...progressSamples].reverse()) {
        reverse.push({ progress, ...await navigate(progress) });
      }
      const about = await navigate(1);
      const projects = await navigate(0);
      samples.push({ width, forward, held, reverse, about, projects });
      check(`${width}: responsive aperture selected`, forward.every(state => state.aperture?.mobile
        && state.canvases === 1 && !state.overflow), forward[0]);
      check(`${width}: sampled progress and visibility match navigation`, forward.every(state =>
        Math.abs(state.aperture?.progress - state.progress) < .001
        && state.aperture?.enabled === (state.progress > 0)), forward.map(({ progress, aperture }) => ({ progress, aperture })));
      check(`${width}: all visual uniforms are finite`, forward.every(state => visualFields.every(field =>
        Number.isFinite(state.aperture?.[field]))));
      check(`${width}: opening radius grows monotonically`, forward.every((state, index) => index === 0
        || state.aperture.radius > forward[index - 1].aperture.radius), forward.map(state => state.aperture?.radius));
      check(`${width}: held poses stay completely stationary`, forward.every((state, index) =>
        samePose(state.aperture, held[index].aperture)), { forward: forward.map(state => state.aperture), held: held.map(state => state.aperture) });
      check(`${width}: rewinding restores the same poses`, forward.every(state =>
        samePose(state.aperture, reverse.find(other => other.progress === state.progress)?.aperture)),
      reverse.map(state => ({ progress: state.progress, aperture: state.aperture })));
      check(`${width}: Projects and About endpoints disable the aperture`, projects.scene === 'projects'
        && projects.aperture?.enabled === false && about.scene === 'about-us' && about.aperture?.enabled === false,
      { projects, about });
    }

    await ready(1440, 900);
    const desktopBefore = await navigate(.5);
    await page.waitForTimeout(500);
    const desktopAfter = await snapshot();
    samples.push({ width: 1440, before: desktopBefore, after: desktopAfter });
    check('desktop retains its aperture mode', desktopBefore.aperture?.mobile === false
      && desktopBefore.aperture?.enabled === true && desktopBefore.canvases === 1, desktopBefore);
    check('desktop edge clock continues at a held midpoint', desktopAfter.aperture?.clock > desktopBefore.aperture?.clock,
      { before: desktopBefore.aperture, after: desktopAfter.aperture });
    check('desktop midpoint radius retains its original value', Math.abs(desktopAfter.aperture?.radius - .270) < .001,
      desktopAfter.aperture);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await ready(390, 844);
    const reducedBefore = await navigate(.5);
    await page.waitForTimeout(500);
    const reducedAfter = await snapshot();
    samples.push({ width: 390, reducedBefore, reducedAfter });
    check('reduced motion disables the aperture and its clock', reducedBefore.aperture?.mobile === true
      && reducedBefore.aperture?.enabled === false && reducedAfter.aperture?.enabled === false
      && reducedBefore.aperture?.clock === 0 && reducedAfter.aperture?.clock === 0,
    { before: reducedBefore.aperture, after: reducedAfter.aperture });
    check('reduced motion retains the requested scene position', reducedAfter.scene === 'projects'
      && Math.abs(reducedAfter.aperture?.progress - .5) < .001 && reducedAfter.canvases === 1, reducedAfter);
    completed = true;
  } catch (error) {
    check('all planned aperture stages completed', false, String(error));
  } finally {
    page.off('pageerror', onPageError);
    page.off('response', onResponse);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
  check('no page errors or failed same-origin assets', errors.length === 0 && failed.length === 0, { errors, failed });
  if (completed) check('all planned aperture stages completed', true);
  for (const name of planned) if (!checks.has(name)) check(name, false, 'Not reached: an earlier stage failed.');
  const results = planned.map(name => checks.get(name));
  return { passed: results.filter(result => result.pass).length, total: results.length, expected: planned.length,
    completed, checks: results, errors, failed, screenshots, samples };
}
