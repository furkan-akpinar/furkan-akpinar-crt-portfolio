async page => {
  const baseURL = new URL(page.url()).origin;
  const context = page.context();
  const mobile = page, checks = new Map(), errors = [], requests = [], rootSamples = [];
  const planned = ['DPR 3 touch device uses shared CRT asset', 'GPU resolution stays at the 1.5 DPR cap', 'mobile downloads only the single compact CRT asset',
    ...['projects', 'about-us', 'contact', 'hero'].map(scene => `touch menu ${scene}`),
    'controlled touch swipe enters projects', 'one horizontal gesture advances exactly one project', 'one reverse horizontal gesture returns exactly one project',
    'horizontal gestures preserve the story position',
    'sub-threshold touch does not start the aperture', 'short forward swipe starts a gradual automatic aperture',
    'released forward aperture continues automatically', 'new touch during automatic aperture cannot interrupt it',
    'automatic aperture completes in approximately two seconds', 'held touch cannot restart the automatic aperture',
    'held forward finger is bounded to the About endpoint', 'held reverse finger after automatic completion stays consumed',
    'released completed aperture stays stationary', 'sub-threshold reverse touch does not start the aperture',
    'short reverse swipe starts a gradual automatic aperture', 'released reverse aperture continues automatically',
    'new touch during reverse aperture cannot interrupt it', 'reverse aperture completes in approximately two seconds',
    'physical downward touch crossing About starts the reverse aperture', 'held touch cannot restart the reverse aperture',
    'held reverse finger is bounded to the Projects endpoint', 'held forward finger after reverse completion stays consumed',
    'released completed reverse aperture stays stationary', 'fresh touch after reverse completion can return to Hero',
    'fresh forward touch automatically completes a partial aperture', 'fresh reverse touch automatically completes a partial aperture',
    'fresh touch swipe resumes About scrolling', 'About release momentum cannot enter the aperture',
    'aperture gesture keeps the root locked and canvas stable',
    'controlled touch swipe returns to hero',
    'wide rotation retains shared CRT textures', 'no second model requested after rotation', 'all mobile stages keep the root document locked',
    'touch context has no page errors', 'touch scenario completed'];
  let completed = false, apertureFingerHeld = false;
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
    const state = await mobile.evaluate(() => {
      const canvas = document.querySelector('.scene-canvas canvas')?.getBoundingClientRect();
      return {
        time: performance.now(), scrollY, height: innerHeight, documentHeight: document.documentElement.scrollHeight,
        scrollPosition: window.__sceneDiagnostics?.scrollPosition, scrollMode: window.__sceneDiagnostics?.scrollMode,
        storyHeight: window.__sceneDiagnostics?.storyHeight, sceneHeight: window.__sceneDiagnostics?.sceneHeight,
        scene: window.__sceneDiagnostics?.scene, activeIndex: window.__sceneDiagnostics?.ring.activeIndex,
        projectMotion: window.__sceneDiagnostics?.projectMotion, projectExit: window.__sceneDiagnostics?.projectExit,
        canvas: canvas ? { x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height } : null,
      };
    });
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
      return { width: c.width, height: c.height, css: [innerWidth, innerHeight], dpr: devicePixelRatio, coarse: matchMedia('(pointer:coarse)').matches, model: window.__sceneDiagnostics.computer };
    });
    check('DPR 3 touch device uses shared CRT asset', initial.dpr === 3 && initial.coarse && initial.model.assetVariant === 'shared'
      && initial.model.source.endsWith('/models/furkan-crt/furkan-crt-computer.glb')
      && initial.model.meshes === 6 && initial.model.triangles === 9848, initial);
    check('GPU resolution stays at the 1.5 DPR cap', initial.width <= 440 * 1.5 && initial.height <= 956 * 1.5, initial);
    check('mobile downloads only the single compact CRT asset', requests.length === 1
      && requests.every(url => new URL(url).pathname.endsWith('/models/furkan-crt/furkan-crt-computer.glb'))
      && initial.model.textures.length > 0
      && initial.model.textures.every(t => t.width > 0 && t.height > 0 && t.width <= 1024 && t.height <= 1024), requests);
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

    // A short fresh forward gesture owns one timed reveal. It must keep
    // progressing after release without accepting further gestures mid-flight.
    const apertureBefore = await hold(1.42);
    const touchDown = async y => {
      await emulation.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 220, y }] });
      apertureFingerHeld = true;
    };
    const touchMove = async y => {
      await emulation.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 220, y }] });
      await mobile.waitForTimeout(80);
      return snapshot();
    };
    const touchUp = async () => {
      await emulation.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      apertureFingerHeld = false;
    };
    const stationary = (a, b) => Math.abs(a.scrollPosition - b.scrollPosition) <= 2
      && a.scene === b.scene && Math.abs(a.projectExit - b.projectExit) < 0.001;
    const apertureStart = Math.floor(1.42 * apertureBefore.storyHeight);
    const aboutStart = Math.ceil(5.6 * apertureBefore.storyHeight) + 2;
    const apertureSamples = [];
    const waitForAbout = () => mobile.waitForFunction(aboutStart => window.__sceneDiagnostics?.scene === 'about-us'
      && Math.abs(window.__sceneDiagnostics.scrollPosition - aboutStart) <= 2, aboutStart, { timeout: 5000 });
    const waitForProjects = () => mobile.waitForFunction(apertureStart => window.__sceneDiagnostics?.scene === 'projects'
      && Math.abs(window.__sceneDiagnostics.scrollPosition - apertureStart) <= 2, apertureStart, { timeout: 5000 });
    await touchDown(760);
    const belowThreshold = await touchMove(754);
    check('sub-threshold touch does not start the aperture', stationary(apertureBefore, belowThreshold), { apertureBefore, belowThreshold });
    const autoStart = await snapshot();
    const autoEarly = await touchMove(730);
    await touchUp();
    check('short forward swipe starts a gradual automatic aperture', autoEarly.scene === 'projects'
      && autoEarly.scrollPosition >= apertureBefore.scrollPosition && autoEarly.scrollPosition < aboutStart - 300,
    { autoStart, autoEarly, aboutStart });
    await mobile.waitForTimeout(800);
    const autoReleased = await snapshot();
    check('released forward aperture continues automatically', autoReleased.scene === 'projects'
      && autoReleased.scrollPosition > autoEarly.scrollPosition + 20 && autoReleased.scrollPosition < aboutStart - 20,
    { autoEarly, autoReleased });
    await touchDown(500);
    const autoNewTouch = await touchMove(590);
    await touchUp();
    await mobile.waitForTimeout(200);
    const autoAfterNewTouch = await snapshot();
    check('new touch during automatic aperture cannot interrupt it', autoNewTouch.scrollPosition >= autoReleased.scrollPosition
      && autoAfterNewTouch.scrollPosition > autoNewTouch.scrollPosition + 20,
    { autoReleased, autoNewTouch, autoAfterNewTouch });
    await waitForAbout();
    const autoComplete = await snapshot();
    const autoDuration = autoComplete.time - autoStart.time;
    check('automatic aperture completes in approximately two seconds', autoDuration >= 1700 && autoDuration < 2700
      && Math.abs(autoComplete.scrollPosition - aboutStart) <= 2, { autoDuration, autoStart, autoComplete });
    apertureSamples.push(belowThreshold, autoEarly, autoReleased, autoNewTouch, autoAfterNewTouch, autoComplete);

    // A finger held through completion is consumed in both directions. Its later
    // movement must not drag About or restart the reveal; only a fresh gesture can.
    await hold(1.42);
    await touchDown(760);
    const heldStart = await snapshot();
    const heldEarly = await touchMove(730);
    const heldMoveOne = await touchMove(640);
    await mobile.waitForTimeout(650);
    const heldMoveTwo = await touchMove(700);
    await waitForAbout();
    const apertureComplete = await snapshot();
    check('held touch cannot restart the automatic aperture', apertureComplete.time - heldStart.time >= 1700
      && apertureComplete.time - heldStart.time < 2700 && heldMoveOne.scrollPosition >= heldEarly.scrollPosition
      && heldMoveTwo.scrollPosition >= heldMoveOne.scrollPosition,
    { heldStart, heldEarly, heldMoveOne, heldMoveTwo, apertureComplete });
    const boundedAbout = await touchMove(600);
    check('held forward finger is bounded to the About endpoint', stationary(apertureComplete, boundedAbout), { apertureComplete, boundedAbout });
    const consumedReverse = await touchMove(720);
    check('held reverse finger after automatic completion stays consumed', stationary(apertureComplete, consumedReverse), { apertureComplete, consumedReverse });
    await touchUp();
    await mobile.waitForTimeout(250);
    const apertureReleased = await snapshot();
    check('released completed aperture stays stationary', stationary(apertureComplete, apertureReleased), { apertureComplete, apertureReleased });
    apertureSamples.push(heldEarly, heldMoveOne, heldMoveTwo, apertureComplete, boundedAbout, consumedReverse, apertureReleased);

    await swipe({ x: 220, y: 760 }, { x: 220, y: 600 });
    await mobile.waitForTimeout(600);
    const freshAbout = await snapshot();
    check('fresh touch swipe resumes About scrolling', freshAbout.scene === 'about-us'
      && freshAbout.scrollPosition > apertureReleased.scrollPosition + 20, { apertureReleased, freshAbout });
    apertureSamples.push(freshAbout);

    // The same aperture runs automatically in reverse, preserving its original
    // pose progression and ignoring touches until it reaches the film's resting pose.
    const reverseBefore = await hold(aboutStart / apertureBefore.storyHeight);
    await touchDown(400);
    const reverseBelowThreshold = await touchMove(406);
    check('sub-threshold reverse touch does not start the aperture', stationary(reverseBefore, reverseBelowThreshold), { reverseBefore, reverseBelowThreshold });
    const reverseStart = await snapshot();
    const reverseEarly = await touchMove(430);
    await touchUp();
    check('short reverse swipe starts a gradual automatic aperture', reverseEarly.scrollPosition <= reverseBefore.scrollPosition
      && reverseEarly.scrollPosition > apertureStart + 300, { reverseBefore, reverseStart, reverseEarly, apertureStart });
    await mobile.waitForTimeout(800);
    const reverseReleased = await snapshot();
    check('released reverse aperture continues automatically', reverseReleased.scene === 'projects'
      && reverseReleased.scrollPosition < reverseEarly.scrollPosition - 20 && reverseReleased.scrollPosition > apertureStart + 20,
    { reverseEarly, reverseReleased });
    await touchDown(590);
    const reverseNewTouch = await touchMove(500);
    await touchUp();
    await mobile.waitForTimeout(200);
    const reverseAfterNewTouch = await snapshot();
    check('new touch during reverse aperture cannot interrupt it', reverseNewTouch.scrollPosition <= reverseReleased.scrollPosition
      && reverseAfterNewTouch.scrollPosition < reverseNewTouch.scrollPosition - 20,
    { reverseReleased, reverseNewTouch, reverseAfterNewTouch });
    await waitForProjects();
    const reverseComplete = await snapshot();
    const reverseDuration = reverseComplete.time - reverseStart.time;
    check('reverse aperture completes in approximately two seconds', reverseDuration >= 1700 && reverseDuration < 2700
      && Math.abs(reverseComplete.scrollPosition - apertureStart) <= 2, { reverseDuration, reverseStart, reverseComplete });
    apertureSamples.push(reverseBefore, reverseBelowThreshold, reverseEarly, reverseReleased, reverseNewTouch, reverseAfterNewTouch, reverseComplete);

    // An actual finger crossing the About boundary may start the return; release
    // momentum alone may not. Keep this finger held to test endpoint consumption.
    const crossingBefore = await hold((aboutStart + 40) / apertureBefore.storyHeight);
    await touchDown(400);
    const reverseHeldStart = await snapshot();
    const crossingEarly = await touchMove(480);
    await mobile.waitForTimeout(350);
    const crossingProgress = await snapshot();
    check('physical downward touch crossing About starts the reverse aperture', crossingBefore.scene === 'about-us'
      && crossingProgress.scene === 'projects' && crossingProgress.scrollPosition < aboutStart - 20
      && crossingProgress.scrollPosition > apertureStart + 20, { crossingBefore, crossingEarly, crossingProgress });
    const reverseHeldMoveOne = await touchMove(560);
    await mobile.waitForTimeout(400);
    const reverseHeldMoveTwo = await touchMove(500);
    await waitForProjects();
    const reverseHeldComplete = await snapshot();
    check('held touch cannot restart the reverse aperture', reverseHeldComplete.time - reverseHeldStart.time >= 1700
      && reverseHeldComplete.time - reverseHeldStart.time < 2700
      && reverseHeldMoveOne.scrollPosition <= crossingProgress.scrollPosition
      && reverseHeldMoveTwo.scrollPosition <= reverseHeldMoveOne.scrollPosition,
    { reverseHeldStart, crossingProgress, reverseHeldMoveOne, reverseHeldMoveTwo, reverseHeldComplete });
    const boundedProjects = await touchMove(660);
    check('held reverse finger is bounded to the Projects endpoint', stationary(reverseHeldComplete, boundedProjects)
      && boundedProjects.scene === 'projects', { reverseHeldComplete, boundedProjects });
    const consumedForward = await touchMove(500);
    check('held forward finger after reverse completion stays consumed', stationary(reverseHeldComplete, consumedForward), { reverseHeldComplete, consumedForward });
    await touchUp();
    await mobile.waitForTimeout(250);
    const releasedReverseComplete = await snapshot();
    check('released completed reverse aperture stays stationary', stationary(reverseHeldComplete, releasedReverseComplete), { reverseHeldComplete, releasedReverseComplete });
    apertureSamples.push(crossingBefore, crossingEarly, crossingProgress, reverseHeldMoveOne, reverseHeldMoveTwo,
      reverseHeldComplete, boundedProjects, consumedForward, releasedReverseComplete);
    await swipe({ x: 220, y: 400 }, { x: 220, y: 760 });
    await mobile.waitForFunction(() => window.__sceneDiagnostics?.scene === 'hero' && window.__sceneDiagnostics.scrollPosition < 2,
      null, { timeout: 15000 });
    const freshHero = await snapshot();
    check('fresh touch after reverse completion can return to Hero', freshHero.scene === 'hero' && freshHero.scrollPosition < 2, { releasedReverseComplete, freshHero });

    // Partial poses can be reached through navigation/restoration. Either fresh
    // direction must finish the selected route over the full two-second duration.
    for (const direction of ['forward', 'reverse']) {
      const partialBefore = await hold(4.7);
      await touchDown(direction === 'forward' ? 760 : 400);
      const partialStart = await snapshot();
      const partialEarly = await touchMove(direction === 'forward' ? 730 : 430);
      await touchUp();
      if (direction === 'forward') await waitForAbout();
      else await waitForProjects();
      const partialComplete = await snapshot();
      const destination = direction === 'forward' ? aboutStart : apertureStart;
      check(`fresh ${direction} touch automatically completes a partial aperture`, partialBefore.projectExit > 0 && partialBefore.projectExit < 1
        && partialComplete.scene === (direction === 'forward' ? 'about-us' : 'projects')
        && Math.abs(partialComplete.scrollPosition - destination) <= 2
        && partialComplete.time - partialStart.time >= 1700 && partialComplete.time - partialStart.time < 2700,
      { partialBefore, partialStart, partialEarly, partialComplete, destination });
      apertureSamples.push(partialBefore, partialEarly, partialComplete);
    }

    // A quick release inside About retains its normal momentum, but that free
    // movement must stop at the aperture boundary rather than animate its reveal.
    const momentumBefore = await hold((aboutStart + 150) / apertureBefore.storyHeight);
    await touchDown(400);
    await emulation.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 220, y: 460 }] });
    await touchUp();
    const momentumSamples = [];
    for (const delay of [80, 120, 450]) {
      await mobile.waitForTimeout(delay);
      momentumSamples.push(await snapshot());
    }
    const momentumAfter = momentumSamples[momentumSamples.length - 1];
    check('About release momentum cannot enter the aperture', momentumBefore.scene === 'about-us'
      && momentumSamples.every(state => state.scene === 'about-us' && state.scrollPosition >= aboutStart - 2)
      && momentumAfter.scrollPosition < momentumBefore.scrollPosition - 65,
    { momentumBefore, momentumSamples, aboutStart, fingerTravel: 60 });
    apertureSamples.push(momentumBefore, ...momentumSamples);

    check('aperture gesture keeps the root locked and canvas stable', apertureBefore.canvas
      && apertureSamples.every(state => state.scrollMode === 'controlled' && state.scrollY === 0 && state.documentHeight <= state.height
        && state.sceneHeight === apertureBefore.sceneHeight && state.canvas
        && ['x', 'y', 'width', 'height'].every(key => Math.abs(state.canvas[key] - apertureBefore.canvas[key]) < 0.5)),
    { apertureBefore, apertureSamples });

    // Return through the menu so the hero reverse check starts at the film's
    // resting position, independent of the completed aperture and About swipe.
    await navigate('Projeler', 'projects');
    await snapshot();
    await swipe({ x: 220, y: 400 }, { x: 220, y: 760 });
    await mobile.waitForFunction(() => window.__sceneDiagnostics.scene === 'hero' && window.__sceneDiagnostics.scrollPosition < 2, null, { timeout: 15000 });
    check('controlled touch swipe returns to hero', (await snapshot()).scrollMode === 'controlled');
    await mobile.setViewportSize({ width: 956, height: 440 });
    await emulation.send('Emulation.setDeviceMetricsOverride', {width:956,height:440,deviceScaleFactor:3,mobile:true});
    await mobile.waitForTimeout(800);
    check('wide rotation retains shared CRT textures', await mobile.evaluate(() => {
      const model = window.__sceneDiagnostics.computer;
      return model.assetVariant === 'shared' && model.source.endsWith('/models/furkan-crt/furkan-crt-computer.glb')
        && model.meshes === 6 && model.triangles === 9848 && model.textures.length > 0
        && model.textures.every(t => t.width > 0 && t.height > 0 && t.width <= 1024 && t.height <= 1024);
    }));
    check('no second model requested after rotation', requests.length === 1
      && new URL(requests[0]).pathname.endsWith('/models/furkan-crt/furkan-crt-computer.glb'));
    await snapshot();
    check('all mobile stages keep the root document locked', rootSamples.length > 0 && rootSamples.every(state => state.scrollMode === 'controlled'
      && state.scrollY === 0 && state.documentHeight <= state.height && Number.isFinite(state.scrollPosition) && state.sceneHeight > 0), rootSamples);
    completed = true;
  } catch (error) { errors.push(`Automation: ${String(error)}`); }
  finally {
    mobile.off('pageerror', onPageError);
    mobile.off('request', onRequest);
    if (apertureFingerHeld) await emulation.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
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
