async page => {
  const origin = new URL(page.url()).origin;
  await page.goto(origin + '/?renderer=none');
  const results = [], errors = [], owned = [];
  const media = /\/images\/(?:projects\/posters\/[^/?]+|about-portrait\.webp|contact-portrait\.webp)(?:\?|$)/;
  const expected = 35;
  let completed = false;
  const check = (name, pass, detail) => results.push({name, pass: Boolean(pass), detail});
  const create = async ({mobile = false, reduced = false, hold = media, fault = null} = {}) => {
    const context = await page.context().browser().newContext({
      viewport: mobile ? {width:390,height:844} : {width:1440,height:900},
      deviceScaleFactor: mobile ? 3 : 1, isMobile: mobile, hasTouch: mobile,
      reducedMotion: reduced ? 'reduce' : 'no-preference',
    });
    const target = await context.newPage();
    const entry = {context, target, requests:[], held:[], faults:[], release:()=>{}, closed:false};
    owned.push(entry);
    target.on('pageerror', error => errors.push(error.message));
    target.on('request', request => entry.requests.push(request.url()));
    await target.addInitScript(() => {
      const audit = window.__startupAudit = {frames:[], noticeSeen:false};
      const sample = () => {
        const d = window.__sceneDiagnostics;
        if(d) audit.frames.push({time:performance.now(),intro:d.intro,ready:d.contentReady,
          gallery:d.gallery.readyCount,prepared:d.preparedPosters,position:d.scrollPosition});
        if(audit.frames.length>3000)audit.frames.shift();
        audit.noticeSeen ||= Boolean(document.querySelector('.content-loading-notice'));
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    let release;
    const barrier = new Promise(resolve => {release=resolve;});
    entry.release = release;
    if(hold)await target.route(hold, async route => {
      entry.held.push(route.request().url());
      await barrier;
      if(!entry.closed)await route.continue().catch(()=>{});
    });
    if(fault)await target.route(fault,route=>{entry.faults.push(route.request().url());return route.abort();});
    await target.goto(origin+'/?renderer=webgl',{waitUntil:'domcontentloaded'});
    if(fault){await target.waitForSelector('.is-fallback',{timeout:60000});return entry;}
    await target.waitForFunction(()=>Boolean(window.__sceneDiagnostics),null,{timeout:60000});
    for(let i=0;i<200&&entry.held.length===0;i++)await target.waitForTimeout(25);
    if(!entry.held.length)throw new Error('Expected held requests did not start.');
    return entry;
  };
  const state = entry => entry.target.evaluate(()=>({
    d:window.__sceneDiagnostics, audit:window.__startupAudit,
    booted:document.querySelector('.experience').classList.contains('is-ready'),
    status:document.querySelector('.experience').dataset.rendererStatus,
    canvases:document.querySelectorAll('.scene-canvas canvas').length,
    notice:Boolean(document.querySelector('.content-loading-notice')),
    scrollY,documentHeight:document.documentElement.scrollHeight,viewportHeight:innerHeight,
  }));
  const release = async entry => {
    entry.release();
    await entry.target.waitForFunction(()=>document.querySelector('.is-ready')
      &&window.__sceneDiagnostics?.intro===1,null,{timeout:120000});
    await entry.target.waitForFunction(()=>window.__startupAudit.frames.some(frame=>frame.intro===1),null,{timeout:5000});
  };
  const navigate = async (entry, scene, vh) => {
    await entry.target.evaluate(vh=>window.dispatchEvent(new CustomEvent('study-navigate',
      {detail:vh*window.__sceneDiagnostics.storyHeight})),vh);
    await entry.target.waitForFunction(scene=>window.__sceneDiagnostics?.scene===scene
      &&!window.__sceneDiagnostics.menuSignal.active,scene,{timeout:30000});
    await entry.target.waitForTimeout(200);
  };
  const close = async entry => {
    if(entry.closed)return;
    entry.closed=true;entry.release();await entry.context.close();
  };
  try {
    for(const mobile of [true,false]){
      const label=mobile?'mobile':'desktop';
      const entry=await create({mobile});
      await entry.target.waitForTimeout(150);
      const held=await state(entry);
      check(label+': secondary images begin during boot',entry.held.length>=2&&held.d.intro===0,entry.held);
      check(label+': intro stays closed until every destination is ready',!held.booted&&!held.d.contentReady&&held.d.gallery.readyCount===0);
      check(label+': one canvas and correct device model',held.canvases===1&&held.d.computer.textureQuality===(mobile?'mobile':'desktop'));
      await entry.target.evaluate(()=>window.dispatchEvent(new CustomEvent('study-navigate',
        {detail:7.5*window.__sceneDiagnostics.storyHeight})));
      await entry.target.waitForTimeout(100);
      const pending=await state(entry);
      check(label+': early navigation cannot expose an unfinished scene',pending.d.scene==='hero'&&pending.d.scrollPosition===0&&!pending.notice);
      await entry.target.evaluate(()=>window.dispatchEvent(new CustomEvent('study-navigate',{detail:0})));
      await release(entry);
      const ready=await state(entry);
      const introFrames=ready.audit.frames.filter(frame=>frame.intro>0);
      check(label+': all seven posters are uploaded before intro begins',ready.d.gallery.readyCount===7&&ready.d.preparedPosters===7
        &&introFrames.length>0&&introFrames.every(frame=>frame.ready&&frame.gallery===7&&frame.prepared===7));
      check(label+': no per-section preparation notice is created',!ready.audit.noticeSeen&&!ready.notice);
      const requestCount=entry.requests.filter(url=>media.test(url)).length;
      await navigate(entry,'projects',1.42);
      await navigate(entry,'about-us',5.61);
      await navigate(entry,'contact',13.61);
      await navigate(entry,'projects',1.42);
      check(label+': section navigation needs no new content downloads',requestCount===entry.requests.filter(url=>media.test(url)).length);
      const visited=await state(entry);
      check(label+': complete film and accepted model lighting survive navigation',visited.d.ring.panelCount===17
        &&visited.d.computer.triangles===99834&&visited.d.ground.lightIntensity===20&&visited.d.ground.floorBounce===1.85);
      check(label+': correct scroll mode remains intact',mobile
        ?visited.d.scrollMode==='controlled'&&visited.scrollY===0&&visited.documentHeight<=visited.viewportHeight
        :visited.d.scrollMode==='native');
      await close(entry);
    }
    const delayed=await create({hold:/\/images\/projects\/posters\/01-[^/?]+/});
    await delayed.target.waitForTimeout(35_000);
    const waiting=await state(delayed);
    check('a queued desktop poster remains pending after thirty seconds',waiting.d?.gallery.readyCount===6
      &&waiting.d.gallery.error===null&&!waiting.booted&&waiting.status!=='fallback');
    await release(delayed);
    const delayedReady=await state(delayed);
    check('a delayed desktop poster opens the complete scene after arriving',delayedReady.booted
      &&delayedReady.d.contentReady&&delayedReady.d.preparedPosters===7);
    await close(delayed);
    const fonts=await create({mobile:true,hold:/\/fonts\/.*\.woff2(?:\?|$)/});
    check('model starts while fonts are still downloading',fonts.requests.some(url=>/\/models\/.*\.gltf/.test(url)));
    const fontState=await state(fonts);
    check('fallback font measurements never open the intro',!fontState.booted&&fontState.d.fontsReady===false);
    await release(fonts);
    check('font release prepares all destinations', (await state(fonts)).d.contentReady);
    await close(fonts);
    const skipped=await create({mobile:true});
    await skipped.target.locator('.skip-link').evaluate(link=>link.click());
    const beforeSkip=await state(skipped);
    check('normal-motion skip cannot bypass unfinished resources',!beforeSkip.booted&&beforeSkip.d.intro===0);
    await release(skipped);
    const afterSkip=await state(skipped),skipFrames=afterSkip.audit.frames.filter(frame=>frame.intro>0);
    check('normal-motion skip opens fully prepared content without playing the intro',afterSkip.booted&&afterSkip.d.contentReady
      &&skipFrames.length>0&&skipFrames.every(frame=>frame.intro===1));
    await close(skipped);
    const reduced=await create({mobile:true,reduced:true});
    await release(reduced);
    const reducedState=await state(reduced);
    check('reduced motion opens only with full readiness',reducedState.booted&&reducedState.d.contentReady&&reducedState.d.intro===1);
    check('reduced motion keeps the video paused',reducedState.d.heroReel.paused);
    await close(reduced);
    const disposal=await create({mobile:true});
    const errorsBeforeLeaving=errors.length;
    await disposal.target.goto('about:blank');disposal.release();
    await disposal.target.waitForTimeout(50);
    check('navigation away during preparation completes without a page error',disposal.target.url()==='about:blank'&&errors.length===errorsBeforeLeaving);
    await close(disposal);
    for(const [label,fault] of [
      ['project poster',/\/images\/projects\/posters\/01-[^/?]+/],
      ['About portrait',/\/images\/about-portrait\.webp(?:\?|$)/],
      ['contact portrait',/\/images\/contact-portrait\.webp(?:\?|$)/],
      ['font',/\/fonts\/.*\.woff2(?:\?|$)/],
      ['NO SIGNAL image',/\/textures\/no-signal-label\.webp(?:\?|$)/],
    ]){
      const failure=await create({mobile:true,hold:null,fault});
      check(label+' failure shows readable fallback instead of an incomplete GPU scene',failure.faults.length>0
        &&await failure.target.locator('.is-fallback #accessible-content').isVisible()
        &&await failure.target.locator('.scene-canvas canvas').count()===0);
      await close(failure);
    }
    completed=true;
  }catch(error){errors.push(error.message);}
  finally{for(const entry of owned)await close(entry).catch(error=>errors.push(error.message));}
  check('startup has no unhandled page errors',errors.length===0,errors);
  check('all startup cases completed',completed);
  while(results.length<expected)check('Unreached check '+results.length,false,'Suite stopped early.');
  return {completed,expected,total:results.length,passed:results.filter(r=>r.pass).length,checks:results,errors};
}
