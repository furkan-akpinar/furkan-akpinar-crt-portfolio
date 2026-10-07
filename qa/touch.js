async page => {
  const baseURL = new URL(page.url()).origin;
  const context = page.context();
  const mobile = page, checks = new Map(), errors = [], requests = [], rootSamples = [];
  const planned = ['DPR 3 touch device uses mobile model', 'GPU resolution stays at the 1.5 DPR cap', 'mobile never downloads 4K textures',
    ...['projects', 'about-us', 'contact', 'hero'].map(scene => `touch menu ${scene}`),
    'controlled touch swipe enters projects', 'one horizontal gesture advances exactly one project', 'one reverse horizontal gesture returns exactly one project',
    'horizontal gestures preserve the story position', 'controlled touch swipe returns to hero',
    'wide rotation retains mobile textures', 'no second model requested after rotation', 'all mobile stages keep the root document locked',
    'touch context has no page errors', 'touch scenario completed'];
  let completed = false;
  const emulation = await context.newCDPSession(mobile);
  const originalAgent = await mobile.evaluate(() => navigator.userAgent);
  await mobile.setViewportSize({width:440,height:956});
  await emulation.send('Emulation.setDeviceMetricsOverride', {width:440,height:956,deviceScaleFactor:3,mobile:true});
  await emulation.send('Emulation.setTouchEmulationEnabled', {enabled:true,maxTouchPoints:5});
  await emulation.send('Emulation.setUserAgentOverride', {userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'});
  const check = (name, pass, detail) => checks.set(name, { name, pass: Boolean(pass), detail });
  const onPageError = error => errors.push(error.message);
  const onRequest = request => { if (request.url().includes('/models/')) requests.push(request.url()); };
  mobile.on('pageerror', onPageError);
  mobile.on('request', onRequest);
  const snapshot = async () => {
    const state = await mobile.evaluate(() => ({
      scrollY, height: innerHeight, documentHeight: document.documentElement.scrollHeight,
      scrollPosition: window.__sceneDiagnostics?.scrollPosition, scrollMode: window.__sceneDiagnostics?.scrollMode,
      storyHeight: window.__sceneDiagnostics?.storyHeight, sceneHeight: window.__sceneDiagnostics?.sceneHeight,
      scene: window.__sceneDiagnostics?.scene, activeIndex: window.__sceneDiagnostics?.ring.activeIndex,
      projectMotion: window.__sceneDiagnostics?.projectMotion,
    }));
    rootSamples.push(state);
    return state;
  };
  const hold = async vh => {
    await mobile.evaluate(vh => window.dispatchEvent(new CustomEvent('study-navigate', { detail: vh * window.__sceneDiagnostics.storyHeight })), vh);
    await mobile.waitForTimeout(1300);
    return snapshot();
  };
  try {
    await mobile.bringToFront();
    await mobile.emulateMedia({ reducedMotion: 'no-preference' });
    await mobile.goto(baseURL + '/?renderer=webgl');
    await mobile.waitForFunction(() => document.querySelector('.is-ready') && window.__sceneDiagnostics?.intro === 1, null, { timeout: 120000 });
    const initial = await mobile.evaluate(() => {
      const c = document.querySelector('.scene-canvas canvas');
      return { width: c.width, height: c.height, css: [innerWidth, innerHeight], dpr: devicePixelRatio, coarse: matchMedia('(pointer:coarse)').matches, model: window.__sceneDiagnostics.computer.textureQuality };
    });
    check('DPR 3 touch device uses mobile model', initial.dpr === 3 && initial.coarse && initial.model === 'mobile', initial);
    check('GPU resolution stays at the 1.5 DPR cap', initial.width <= 440 * 1.5 && initial.height <= 956 * 1.5, initial);
    check('mobile never downloads 4K textures', requests.filter(url => url.includes('/web/images/')).length === 0, requests);
    await snapshot();
    await mobile.screenshot({ path: 'artifacts/live-touch-dpr3-hero.png' });
    const tap = async locator => {
      await locator.waitFor({state:'visible'});
      const box = await locator.boundingBox();
      if (!box) throw new Error('Touch target has no visible bounds.');
      await emulation.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2}]});
      await emulation.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    };
    const navigate = async (label, scene) => {
      await tap(mobile.getByRole('button', { name: 'Menüyü aç', exact: true }));
      await tap(mobile.locator('#section-navigation').getByRole('button', { name: label, exact: true }));
      try {
        await mobile.waitForFunction(scene => window.__sceneDiagnostics?.scene === scene && !window.__sceneDiagnostics.menuSignal.active, scene, { timeout: 30000 });
      } catch (error) {
        const state = await mobile.evaluate(() => ({scrollY, innerHeight, visibility: document.visibilityState, diagnostics: window.__sceneDiagnostics, menu: document.querySelector('#section-navigation')?.outerHTML}));
        await mobile.screenshot({path:'artifacts/live-touch-failure.png'});
        check(`touch navigation state ${label}`, false, state);
        throw error;
      }
      await mobile.waitForTimeout(1600);
    };
    for (const [label, scene] of [['Projeler', 'projects'], ['Hakkımda', 'about-us'], ['İletişim', 'contact'], ['Ana Sayfa', 'hero']]) {
      await navigate(label, scene);
      check(`touch menu ${scene}`, await mobile.evaluate(scene => window.__sceneDiagnostics.scene === scene && document.documentElement.scrollWidth <= innerWidth, scene));
      await snapshot();
    }
    const swipe = async (from, to) => {
      await emulation.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
      for (let step = 1; step <= 8; step++) {
        await emulation.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
          x: from.x + (to.x - from.x) * step / 8, y: from.y + (to.y - from.y) * step / 8,
        }] });
        await snapshot();
        await mobile.waitForTimeout(35);
      }
      await emulation.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await swipe({ x: 220, y: 760 }, { x: 220, y: 400 });
    await mobile.waitForFunction(() => window.__sceneDiagnostics.scene === 'projects' && window.__sceneDiagnostics.travel === 1, null, { timeout: 15000 });
    await mobile.waitForTimeout(700);
    const entered = await snapshot();
    check('controlled touch swipe enters projects', entered.scrollMode === 'controlled'
      && Math.abs(entered.scrollPosition / entered.storyHeight - 1.42) < 0.01, entered);
    const horizontalBefore = await hold(1.42);
    await swipe({ x: 345, y: 440 }, { x: 95, y: 440 });
    await mobile.waitForTimeout(900);
    const horizontalAfter = await snapshot();
    await mobile.waitForTimeout(800);
    const horizontalSettled = await snapshot();
    check('one horizontal gesture advances exactly one project', horizontalAfter.projectMotion === 1
      && horizontalAfter.activeIndex === (horizontalBefore.activeIndex + 1) % 7
      && horizontalSettled.activeIndex === horizontalAfter.activeIndex, { horizontalBefore, horizontalAfter, horizontalSettled });
    await swipe({ x: 95, y: 440 }, { x: 345, y: 440 });
    await mobile.waitForTimeout(1700);
    const horizontalReverse = await snapshot();
    check('one reverse horizontal gesture returns exactly one project', horizontalReverse.projectMotion === 1
      && horizontalReverse.activeIndex === horizontalBefore.activeIndex, { horizontalBefore, horizontalReverse });
    check('horizontal gestures preserve the story position', [horizontalAfter, horizontalSettled, horizontalReverse].every(state => state.scene === 'projects'
      && Math.abs(state.scrollPosition - horizontalBefore.scrollPosition) <= 2), { horizontalBefore, horizontalAfter, horizontalSettled, horizontalReverse });
    await swipe({ x: 220, y: 400 }, { x: 220, y: 760 });
    await mobile.waitForFunction(() => window.__sceneDiagnostics.scene === 'hero' && window.__sceneDiagnostics.scrollPosition < 2, null, { timeout: 15000 });
    check('controlled touch swipe returns to hero', (await snapshot()).scrollMode === 'controlled');
    await mobile.setViewportSize({ width: 956, height: 440 });
    await emulation.send('Emulation.setDeviceMetricsOverride', {width:956,height:440,deviceScaleFactor:3,mobile:true});
    await mobile.waitForTimeout(800);
    check('wide rotation retains mobile textures', await mobile.evaluate(() => window.__sceneDiagnostics.computer.textureQuality === 'mobile'));
    check('no second model requested after rotation', requests.filter(url => url.endsWith('.gltf')).length === 1);
    await snapshot();
    check('all mobile stages keep the root document locked', rootSamples.length > 0 && rootSamples.every(state => state.scrollMode === 'controlled'
      && state.scrollY === 0 && state.documentHeight <= state.height && Number.isFinite(state.scrollPosition) && state.sceneHeight > 0), rootSamples);
    completed = true;
  } catch (error) { errors.push(`Automation: ${String(error)}`); }
  finally {
    mobile.off('pageerror', onPageError);
    mobile.off('request', onRequest);
    await emulation.send('Emulation.clearDeviceMetricsOverride');
    await emulation.send('Emulation.setTouchEmulationEnabled',{enabled:false});
    await emulation.send('Emulation.setUserAgentOverride',{userAgent:originalAgent});
    await emulation.detach();
  }
  check('touch context has no page errors', errors.length === 0, errors);
  check('touch scenario completed', completed);
  const results = planned.map(name => checks.get(name) ?? { name, pass: false, detail: 'Not reached because an earlier automation stage failed.' });
  return { engine: 'Windows Chromium, touch/DPR emulation; not physical iOS Safari', completed, expected: planned.length,
    passed: results.filter(c => c.pass).length, total: results.length, checks: results, errors };
}
