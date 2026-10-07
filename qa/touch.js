async page => {
  const baseURL = new URL(page.url()).origin;
  const context = page.context();
  const mobile = page, checks = [], errors = [], requests = [];
  const emulation = await context.newCDPSession(mobile);
  const originalAgent = await mobile.evaluate(() => navigator.userAgent);
  await mobile.setViewportSize({width:440,height:956});
  await emulation.send('Emulation.setDeviceMetricsOverride', {width:440,height:956,deviceScaleFactor:3,mobile:true});
  await emulation.send('Emulation.setTouchEmulationEnabled', {enabled:true,maxTouchPoints:5});
  await emulation.send('Emulation.setUserAgentOverride', {userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'});
  const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail });
  mobile.on('pageerror', error => errors.push(error.message));
  mobile.on('request', request => { if (request.url().includes('/models/')) requests.push(request.url()); });
  try {
    await mobile.bringToFront();
    await mobile.goto(baseURL + '/?renderer=webgl');
    await mobile.waitForFunction(() => document.querySelector('.is-ready') && window.__sceneDiagnostics?.intro === 1, null, { timeout: 120000 });
    const initial = await mobile.evaluate(() => {
      const c = document.querySelector('.scene-canvas canvas');
      return { width: c.width, height: c.height, css: [innerWidth, innerHeight], dpr: devicePixelRatio, coarse: matchMedia('(pointer:coarse)').matches, model: window.__sceneDiagnostics.computer.textureQuality };
    });
    check('DPR 3 touch device uses mobile model', initial.dpr === 3 && initial.coarse && initial.model === 'mobile', initial);
    check('GPU resolution stays at the 1.5 DPR cap', initial.width <= 440 * 1.5 && initial.height <= 956 * 1.5, initial);
    check('mobile never downloads 4K textures', requests.filter(url => url.includes('/web/images/')).length === 0, requests);
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
    }
    const input = await context.newCDPSession(mobile);
    const swipe = async (from, to) => {
      await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 220, y: from }] });
      for (let step = 1; step <= 8; step++) {
        await input.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 220, y: from + (to - from) * step / 8 }] });
        await mobile.waitForTimeout(35);
      }
      await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await swipe(760, 400);
    await mobile.waitForFunction(() => window.__sceneDiagnostics.scene === 'projects' && window.__sceneDiagnostics.travel === 1, null, { timeout: 15000 });
    await mobile.waitForTimeout(700);
    check('native touch swipe enters projects', true);
    await swipe(400, 760);
    await mobile.waitForFunction(() => scrollY < 2, null, { timeout: 15000 });
    check('native touch swipe returns to hero', true);
    await input.detach();
    await emulation.send('Emulation.setDeviceMetricsOverride', {width:956,height:440,deviceScaleFactor:3,mobile:true});
    await mobile.waitForTimeout(800);
    check('wide rotation retains mobile textures', await mobile.evaluate(() => window.__sceneDiagnostics.computer.textureQuality === 'mobile'));
    check('no second model requested after rotation', requests.filter(url => url.endsWith('.gltf')).length === 1);
    check('touch context has no page errors', errors.length === 0, errors);
  } catch (error) { check('touch scenario completion', false, String(error)); }
  finally {
    await emulation.send('Emulation.clearDeviceMetricsOverride');
    await emulation.send('Emulation.setTouchEmulationEnabled',{enabled:false});
    await emulation.send('Emulation.setUserAgentOverride',{userAgent:originalAgent});
    await emulation.detach();
  }
  return { engine: 'Windows Chromium, touch/DPR emulation; not physical iOS Safari', passed: checks.filter(c => c.pass).length, total: checks.length, checks, errors };
}
