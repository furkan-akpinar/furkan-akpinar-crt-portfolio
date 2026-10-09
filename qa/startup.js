async page => {
  const origin = new URL(page.url()).origin;
  const checks = new Map(), errors = [], samples = [], owned = [];
  const planned = [
    'mobile hero opens while secondary requests are held',
    'secondary requests begin only after the intro completes',
    'mobile startup uses one canvas and the mobile model',
    'upward touch queues Projects without moving the hero',
    'reverse touch cancels the pending destination',
    'menu can replace a pending Projects request with Contact',
    'Home cancels a pending menu destination',
    'cancelled destination does not resume after assets arrive',
    'cancelled mobile startup keeps the root document locked',
    'queued Projects remains on Hero until all secondary assets finish',
    'queued Projects uses the original gradual monitor transition',
    'queued Projects reaches the correct film position',
    'film has all seven posters before it becomes visible',
    'released content clears the loading notice',
    'first visible film preserves the approved geometry and lighting',
    'native startup cannot enter About while its assets are held',
    'queued About opens after release with the paper rendered',
    'latest pending menu destination wins after release',
    'numeric navigation still reaches the paper curl after readiness',
    'normal Contact navigation still renders after readiness',
    'native keyboard Home cancels a pending numeric destination',
    'cancelled native destination stays at Hero after release',
    'reduced-motion startup queues Contact without moving the hero',
    'reduced-motion queued Contact opens without a monitor journey',
    'reduced-motion video remains paused',
    'navigation away safely disposes a pending startup',
    'startup scenarios have no page errors',
    'all startup scenarios completed',
  ];
  const secondary = /\/images\/(?:projects\/posters\/[^/?]+|people-atlas\.webp|about-team\.webp)(?:\?|$)/;
  const check = (name, pass, detail) => checks.set(name, { name, pass: Boolean(pass), detail });
  let completed = false;

  const create = async ({ mobile = false, reduced = false } = {}) => {
    const target = await page.context().newPage();
    const entry = { page: target, cdp: null, route: null, release: () => {}, closed: false };
    owned.push(entry);
    target.setDefaultTimeout(30000);
    target.setDefaultNavigationTimeout(30000);
    target.on('pageerror', error => errors.push(error.message));
    await target.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 768, height: 1024 });
    await target.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    if (mobile) {
      entry.cdp = await target.context().newCDPSession(target);
      await entry.cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
      await entry.cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    // Observe the actual render clock without changing application state. A
    // request can start in the same frame in which this observer first sees 1.
    await target.addInitScript(() => {
      const audit = window.__startupAudit = { introAt: null, frames: [] };
      const frame = () => {
        const d = window.__sceneDiagnostics;
        if (d) {
          const time = performance.now();
          if (audit.introAt === null && d.intro >= 1) audit.introAt = time;
          audit.frames.push({ time, intro: d.intro, scene: d.scene, travel: d.travel,
            ready: d.contentReady, gallery: d.gallery?.readyCount, scroll: d.scrollPosition,
            nativeScroll: scrollY });
          if (audit.frames.length > 900) audit.frames.shift();
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    let release;
    const barrier = new Promise(resolve => { release = resolve; });
    entry.release = release;
    entry.observations = [];
    let initialRequests;
    const initialHeld = new Promise(resolve => { initialRequests = resolve; });
    entry.route = async route => {
      try {
        const observation = await target.evaluate(() => ({ time: performance.now(), intro: window.__sceneDiagnostics?.intro,
          observedIntroAt: window.__startupAudit?.introAt }));
        entry.observations.push({ url: route.request().url(), ...observation });
        if (entry.observations.length >= 2) initialRequests();
        await barrier;
        if (!target.isClosed()) await route.continue();
      } catch (error) {
        if (!entry.closed && !entry.cancelPending && !target.isClosed()) errors.push(`Secondary request: ${error.message}`);
      }
    };
    await target.route(secondary, entry.route);
    await target.bringToFront();
    await target.goto(origin + '/?renderer=webgl', { waitUntil: 'domcontentloaded' });
    await target.waitForFunction(() => document.querySelector('.is-ready') && window.__sceneDiagnostics?.intro === 1, null, { timeout: 30000 });
    await target.waitForFunction(() => window.__sceneDiagnostics?.contentStarted === true, null, { timeout: 30000 });
    let requestTimer;
    try {
      await Promise.race([initialHeld, new Promise((_, reject) => {
        requestTimer = setTimeout(() => reject(new Error('Secondary requests did not start after the hero intro.')), 30000);
      })]);
    } finally { clearTimeout(requestTimer); }
    return entry;
  };
  const state = async entry => {
    const result = await entry.page.evaluate(() => {
      const d = window.__sceneDiagnostics;
      return { scene: d?.scene, intro: d?.intro, contentReady: d?.contentReady,
        contentStarted: d?.contentStarted, contentAssetsReady: d?.contentAssetsReady,
        gallery: d?.gallery?.readyCount, panels: d?.ring?.panelCount, travel: d?.travel,
        position: d?.scrollPosition, height: d?.storyHeight, scrollMode: d?.scrollMode,
        scrollY, documentHeight: document.documentElement.scrollHeight, viewportHeight: innerHeight,
        model: d?.computer?.textureQuality, triangles: d?.computer?.triangles,
        light: d?.ground?.lightIntensity, bounce: d?.ground?.floorBounce,
        passes: d?.passes, paused: d?.heroReel?.paused,
        canvasCount: document.querySelectorAll('.scene-canvas canvas').length,
        notice: Boolean(document.querySelector('.content-loading-notice')) };
    });
    samples.push(result);
    return result;
  };
  const heroHeld = value => value.scene === 'hero' && value.intro === 1 && Math.abs(value.position) < 2 && value.scrollY === 0;
  const notice = async (entry, visible) => entry.page.locator('.content-loading-notice').waitFor({ state: visible ? 'visible' : 'hidden', timeout: 30000 });
  const activate = async (entry, locator) => {
    if (!entry.cdp) return locator.click();
    await locator.waitFor({ state: 'visible' });
    const box = await locator.boundingBox();
    if (!box) throw new Error('Startup navigation target has no bounds.');
    await entry.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
    await entry.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const menu = async (entry, label) => {
    const toggle = entry.page.getByRole('button', { name: 'Menüyü aç', exact: true });
    if (await toggle.isVisible()) await activate(entry, toggle);
    await activate(entry, entry.page.locator('#section-navigation').getByRole('button', { name: label, exact: true }));
  };
  const swipe = async (entry, fromY, toY) => {
    await entry.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: fromY }] });
    for (let step = 1; step <= 5; step++) {
      await entry.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y: fromY + (toY - fromY) * step / 5 }] });
      await entry.page.waitForTimeout(25);
    }
    await entry.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const release = async entry => {
    entry.release();
    await entry.page.waitForFunction(() => window.__sceneDiagnostics?.contentReady === true, null, { timeout: 30000 });
  };
  const reached = async (entry, scene) => {
    await entry.page.waitForFunction(scene => window.__sceneDiagnostics?.scene === scene
      && !window.__sceneDiagnostics.menuSignal.active, scene, { timeout: 30000 });
  };
  const close = async entry => {
    if (entry.closed) return;
    entry.closed = true;
    entry.release();
    if (!entry.page.isClosed()) await entry.page.unroute(secondary, entry.route);
    if (entry.cdp) await entry.cdp.detach().catch(() => {});
    if (!entry.page.isClosed()) await entry.page.close();
  };
  try {
    const mobile = await create({ mobile: true });
    const initial = await state(mobile);
    check('mobile hero opens while secondary requests are held', heroHeld(initial) && !initial.contentReady && initial.gallery === 0, initial);
    check('secondary requests begin only after the intro completes', mobile.observations.length >= 2
      && mobile.observations.every(request => request.intro === 1
        && (request.observedIntroAt === null || request.time >= request.observedIntroAt - 35)), mobile.observations);
    check('mobile startup uses one canvas and the mobile model', initial.canvasCount === 1 && initial.model === 'mobile', initial);
    await swipe(mobile, 650, 400);
    await notice(mobile, true);
    const pending = await state(mobile);
    check('upward touch queues Projects without moving the hero', heroHeld(pending) && pending.notice && !pending.contentReady, pending);
    await swipe(mobile, 400, 650);
    await notice(mobile, false);
    check('reverse touch cancels the pending destination', heroHeld(await state(mobile)));
    await menu(mobile, 'Projeler');
    await notice(mobile, true);
    await menu(mobile, 'İletişim');
    check('menu can replace a pending Projects request with Contact', heroHeld(await state(mobile)) && await mobile.page.locator('.content-loading-notice').isVisible());
    await menu(mobile, 'Ana Sayfa');
    await notice(mobile, false);
    check('Home cancels a pending menu destination', heroHeld(await state(mobile)));
    await release(mobile);
    await mobile.page.waitForTimeout(350);
    const cancelled = await state(mobile);
    check('cancelled destination does not resume after assets arrive', heroHeld(cancelled) && cancelled.contentReady && !cancelled.notice, cancelled);
    check('cancelled mobile startup keeps the root document locked', cancelled.scrollMode === 'controlled'
      && cancelled.scrollY === 0 && cancelled.documentHeight <= cancelled.viewportHeight, cancelled);
    await close(mobile);

    const film = await create({ mobile: true });
    const heroCTA = film.page.locator('.hero-scroll-control').and(film.page.getByRole('button', { name: 'Çalışmalarımı keşfet', exact: true }));
    await activate(film, heroCTA);
    await notice(film, true);
    const heldFilm = await state(film);
    check('queued Projects remains on Hero until all secondary assets finish', heroHeld(heldFilm) && heldFilm.gallery === 0 && !heldFilm.contentReady, heldFilm);
    await release(film);
    await reached(film, 'projects');
    await film.page.waitForFunction(() => {
      const d = window.__sceneDiagnostics;
      return d?.travel === 1 && Math.abs(d.scrollPosition - (Math.ceil(1.4 * d.storyHeight) + 2)) < 1;
    }, null, { timeout: 30000 });
    const filmFrames = await film.page.evaluate(() => window.__startupAudit.frames);
    const motion = filmFrames.filter(frame => frame.travel > 0.02 && frame.travel < 0.98);
    check('queued Projects uses the original gradual monitor transition', motion.length >= 3
      && motion.at(-1).time - motion[0].time > 250, { count: motion.length, duration: motion.length ? motion.at(-1).time - motion[0].time : 0 });
    const filmState = await state(film);
    // The CTA uses sceneScrollTop: two pixels inside the 1.4vh scene boundary.
    // Wheel/touch and the menu have their separate, existing 1.42vh snap target.
    check('queued Projects reaches the correct film position', filmState.scene === 'projects'
      && Math.abs(filmState.position - (Math.ceil(1.4 * filmState.height) + 2)) < 1, filmState);
    check('film has all seven posters before it becomes visible', filmState.gallery === 7 && filmState.panels === 17
      && filmFrames.filter(frame => frame.travel > 0.02).every(frame => frame.ready && frame.gallery === 7), filmState);
    await notice(film, false);
    check('released content clears the loading notice', true);
    check('first visible film preserves the approved geometry and lighting', filmState.triangles === 99834 && filmState.light === 20 && filmState.bounce === 1.85, filmState);
    await film.page.screenshot({ path: 'artifacts/startup-deferred-projects.png' });
    await close(film);

    const native = await create();
    await menu(native, 'Projeler');
    await notice(native, true);
    await menu(native, 'Hakkımda');
    await notice(native, true);
    const heldAbout = await state(native);
    check('native startup cannot enter About while its assets are held', heldAbout.scrollMode === 'native' && heroHeld(heldAbout) && !heldAbout.contentReady, heldAbout);
    await release(native);
    await reached(native, 'about-us');
    await native.page.waitForFunction(() => window.__sceneDiagnostics?.passes.includes('about-paper'), null, { timeout: 30000 });
    check('queued About opens after release with the paper rendered', (await state(native)).contentReady);
    check('latest pending menu destination wins after release', (await state(native)).scene === 'about-us');
    await native.page.evaluate(() => window.dispatchEvent(new CustomEvent('study-navigate', { detail: 12.3 * window.__sceneDiagnostics.storyHeight })));
    await native.page.waitForFunction(() => window.__sceneDiagnostics?.passes.includes('intact-page-curl'), null, { timeout: 30000 });
    check('numeric navigation still reaches the paper curl after readiness', true);
    await menu(native, 'İletişim');
    await reached(native, 'contact');
    check('normal Contact navigation still renders after readiness', await native.page.locator('[data-contact-action="github"]').isVisible());
    await close(native);

    const numeric = await create();
    await numeric.page.evaluate(() => window.dispatchEvent(new CustomEvent('study-navigate', { detail: 7.5 * window.__sceneDiagnostics.storyHeight })));
    await notice(numeric, true);
    await numeric.page.keyboard.press('Home');
    await notice(numeric, false);
    check('native keyboard Home cancels a pending numeric destination', heroHeld(await state(numeric)));
    await release(numeric);
    await numeric.page.waitForTimeout(350);
    check('cancelled native destination stays at Hero after release', heroHeld(await state(numeric)));
    await close(numeric);

    const reduced = await create({ mobile: true, reduced: true });
    await menu(reduced, 'İletişim');
    await notice(reduced, true);
    const heldReduced = await state(reduced);
    check('reduced-motion startup queues Contact without moving the hero', heroHeld(heldReduced) && !heldReduced.contentReady, heldReduced);
    await release(reduced);
    await reached(reduced, 'contact');
    const reducedFrames = await reduced.page.evaluate(() => window.__startupAudit.frames);
    check('reduced-motion queued Contact opens without a monitor journey', !reducedFrames.some(frame => frame.travel > 0.02 && frame.travel < 0.98));
    check('reduced-motion video remains paused', (await state(reduced)).paused);
    await close(reduced);

    const disposal = await create({ mobile: true });
    await menu(disposal, 'Projeler');
    await notice(disposal, true);
    disposal.cancelPending = true;
    await disposal.page.goto('about:blank');
    disposal.release();
    check('navigation away safely disposes a pending startup', disposal.page.url() === 'about:blank');
    await close(disposal);
    completed = true;
  } catch (error) {
    errors.push(error.message);
  } finally {
    for (const entry of owned) await close(entry).catch(error => errors.push(`Cleanup: ${error.message}`));
    await page.bringToFront().catch(() => {});
  }
  check('startup scenarios have no page errors', errors.length === 0, errors);
  check('all startup scenarios completed', completed);
  for (const name of planned) if (!checks.has(name)) check(name, false, 'Not reached.');
  const results = planned.map(name => checks.get(name));
  return { completed, expected: planned.length, total: results.length,
    passed: results.filter(result => result.pass).length, checks: results, errors, samples };
}
