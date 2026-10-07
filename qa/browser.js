async page => {
  const baseURL = new URL(page.url()).origin;
  const checks = [], errors = [], failed = [];
  let faultInjection = false;
  let faultPage = null;
  const posterRoute = '**/images/projects/posters/01-karakter-studyo.png';
  const abortPoster = route => route.abort();
  const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail });
  const onPageError = error => { if (!faultInjection) errors.push(error.message); };
  const onResponse = response => { if (!faultInjection && response.status() >= 400 && response.url().startsWith(baseURL + '/')) failed.push({ url: response.url(), status: response.status() }); };
  page.on('pageerror', onPageError);
  page.on('response', onResponse);
  const ready = async (query = '?renderer=webgl') => {
    await page.goto(baseURL + '/' + query);
    await page.waitForFunction(() => document.querySelector('.is-ready,.is-fallback'), null, { timeout: 120000 });
    await page.waitForFunction(() => document.querySelector('.is-fallback') || window.__sceneDiagnostics?.intro === 1, null, { timeout: 30000 });
    if (await page.locator('.is-ready').count()) {
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('study-navigate', { detail: 0 })));
      await page.waitForFunction(() => scrollY < 2, null, { timeout: 15000 });
    }
    await page.waitForTimeout(400);
    const viewport = page.viewportSize();
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
  };
  const menu = async (label, scene) => {
    const toggle = page.getByRole('button', { name: 'Menüyü aç', exact: true });
    if (await toggle.isVisible()) await toggle.click();
    await page.locator('#section-navigation').getByRole('button', { name: label, exact: true }).click();
    await page.waitForFunction(scene => window.__sceneDiagnostics?.scene === scene && !window.__sceneDiagnostics.menuSignal.active, scene, { timeout: 30000 });
    if (scene === 'hero') await page.waitForFunction(() => scrollY < 2);
    if (scene === 'projects') await page.waitForFunction(() => Math.abs(scrollY - 1.42 * innerHeight) < 3);
    await page.waitForTimeout(300);
  };
  try {
  await page.bringToFront();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const [width, height] of [[1440, 900], [390, 844], [768, 1024]]) {
    await page.setViewportSize({ width, height });
    await ready();
    const model = await page.evaluate(() => window.__sceneDiagnostics.computer);
    check(`${width}: correct texture tier`, model.textureQuality === (width < 900 ? 'mobile' : 'desktop') && model.textures.every(t => t.width === (width < 900 ? 1024 : 4096)), model);
    check(`${width}: unchanged geometry`, model.meshes === 7 && model.triangles === 99834);
    check(`${width}: one canvas and approved illumination`, await page.evaluate(() => document.querySelectorAll('.scene-canvas canvas').length === 1 && window.__sceneDiagnostics.ground.lightIntensity === 20 && window.__sceneDiagnostics.ground.floorBounce === 1.85));
    const frame = await page.evaluate(() => window.__sceneDiagnostics.heroReel.frame);
    await page.waitForTimeout(650);
    check(`${width}: video and lighting clock advance`, await page.evaluate(frame => !window.__sceneDiagnostics.heroReel.paused && window.__sceneDiagnostics.heroReel.frame !== frame, frame));
    await menu('Projeler', 'projects');
    check(`${width}: shared seven posters / 17 panels`, await page.evaluate(() => window.__sceneDiagnostics.gallery.readyCount === 7 && window.__sceneDiagnostics.ring.panelCount === 17));
    check(`${width}: poster texture budget`, await page.evaluate(width => window.__sceneDiagnostics.gallery.width === (width < 900 ? 1024 : 1536), width));
    const names = [];
    for (let index = 0; index < 7; index++) {
      names.push(await page.locator('.project-controls .sr-only').textContent());
      const links = await page.locator('[data-project-link]').evaluateAll(elements => elements.map(e => e.getAttribute('href')));
      check(`${width}: project ${index + 1} links`, links.length === 2 && links.every(link => link?.startsWith('https://')), links);
      await page.getByRole('button', { name: 'Sonraki proje', exact: true }).click();
      await page.waitForFunction(expected => window.__sceneDiagnostics.projectMotion === 1 && window.__sceneDiagnostics.ring.activeIndex === expected, (index + 1) % 7);
    }
    check(`${width}: ordered full film loop`, JSON.stringify(names) === JSON.stringify(['KARAKTER STÜDYO', 'KIPIR', 'Snow Medya', 'Ezo Eylül Sağır', 'VANTA DRIVE', 'KOME', 'Furkan Akpınar · Dijital Ajans']), names);
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => window.__sceneDiagnostics.projectMotion === 1 && window.__sceneDiagnostics.ring.activeIndex === 6);
    check(`${width}: keyboard reverse wraps`, true);
    await menu('Ana Sayfa', 'hero');
    check(`${width}: reverse monitor transition`, await page.evaluate(() => window.__sceneDiagnostics.travel < 0.01));
    await menu('Hakkımda', 'about-us');
    check(`${width}: About renders`, await page.evaluate(() => window.__sceneDiagnostics.passes.includes('about-paper')));
    // Sample intact sheet curl, then reverse it through the same scroll owner.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('study-navigate', { detail: 12.3 * innerHeight })));
    await page.waitForFunction(() => window.__sceneDiagnostics?.passes.includes('intact-page-curl'), null, { timeout: 15000 });
    check(`${width}: forward paper curl`, true);
    await menu('Hakkımda', 'about-us');
    check(`${width}: reverse paper curl`, await page.evaluate(() => window.__sceneDiagnostics.passes.includes('about-paper') && !window.__sceneDiagnostics.passes.includes('intact-page-curl')));
    await menu('İletişim', 'contact');
    check(`${width}: contact link`, await page.locator('[data-contact-action="github"]').getAttribute('href') === 'https://github.com/furkan-akpinar');
    check(`${width}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await ready();
  await page.mouse.wheel(0, 120);
  await page.waitForFunction(() => window.__sceneDiagnostics.scene === 'projects' && window.__sceneDiagnostics.travel === 1, null, { timeout: 15000 });
  await page.waitForTimeout(700);
  const scrollBefore = await page.evaluate(() => scrollY);
  await page.setViewportSize({ width: 390, height: 760 });
  await page.waitForTimeout(600);
  check('toolbar height change preserves the film pose', Math.abs(await page.evaluate(() => scrollY / innerHeight) - scrollBefore / 844) <= 0.003, { scrollBefore, after: await page.evaluate(() => scrollY) });
  const selected = await page.evaluate(() => window.__sceneDiagnostics.ring.activeIndex);
  await page.mouse.move(195, 380);
  await page.mouse.wheel(120, 0);
  await page.waitForFunction(index => window.__sceneDiagnostics.ring.activeIndex !== index, selected, { timeout: 12000 });
  check('wheel is not stuck after height change', true);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(800);
  check('rotation retains one mobile model', await page.evaluate(() => window.__sceneDiagnostics.computer.textureQuality === 'mobile' && document.querySelectorAll('.scene-canvas canvas').length === 1));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready();
  check('reduced motion pauses video', await page.evaluate(() => window.__sceneDiagnostics.heroReel.paused));
  await ready('?renderer=none');
  check('GPU-free content available', await page.locator('.fallback-notice').isVisible() && await page.locator('.scene-canvas canvas').count() === 0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 430, height: 932 });
  await ready('');
  check('automatic backend loads mobile tier', await page.evaluate(() => window.__sceneDiagnostics.computer.textureQuality === 'mobile' && ['webgpu', 'webgl2'].includes(document.querySelector('.experience').dataset.rendererStatus)));
  await page.screenshot({ path: 'artifacts/live-after-430-auto.png' });
  await ready();
  faultInjection = true;
  const lost = await page.evaluate(() => {
    const canvas = document.querySelector('.scene-canvas canvas');
    const extension = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context');
    if (!extension) return false;
    extension.loseContext();return true;
  });
  await page.waitForSelector('.is-fallback', { timeout: 15000 });
  check('context loss recovers without a blank canvas', lost && await page.locator('.fallback-notice').isVisible() && await page.locator('.scene-canvas canvas').count() === 0);
  await page.route(posterRoute, abortPoster);
  await ready();
  check('failed poster load falls back and removes canvas', await page.locator('.fallback-notice').isVisible() && await page.locator('.scene-canvas canvas').count() === 0);
  await page.unroute(posterRoute, abortPoster);
  faultPage = await page.context().newPage();
  await faultPage.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type === '2d' ? null : original.call(this, type, ...args); };
  });
  await faultPage.goto(baseURL + '/?renderer=webgl');
  await faultPage.waitForSelector('.is-fallback', { timeout: 30000 });
  check('2D allocation failure is caught during scene construction', await faultPage.locator('.fallback-notice').isVisible() && await faultPage.locator('.scene-canvas canvas').count() === 0);
  await faultPage.close();
  faultPage = null;
  faultInjection = false;
  check('no unexpected page errors or failed assets', errors.length === 0 && failed.length === 0, { errors, failed });
  await ready();
  } catch (error) { check('automation completes every planned stage', false, String(error)); }
  finally {
    await page.unroute(posterRoute, abortPoster);
    if (faultPage && !faultPage.isClosed()) await faultPage.close();
    page.off('pageerror', onPageError);
    page.off('response', onResponse);
  }
  return { passed: checks.filter(c => c.pass).length, total: checks.length, checks, errors, failed };
}
