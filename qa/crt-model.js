async page => {
  const base = new URL(page.url()).origin;
  const results = [], errors = [];
  const onError = error => errors.push(error.message);
  page.on('pageerror', onError);
  try {
    await page.emulateMedia({reducedMotion:'no-preference'});
    for (const [width,height] of [[1440,900],[768,1024],[390,844],[320,844]]) {
      await page.setViewportSize({width,height});
      await page.goto(base+'/?renderer=webgl');
      await page.waitForFunction(()=>window.__sceneDiagnostics?.intro===1&&document.querySelector('.is-ready'),null,{timeout:60000});
      await page.mouse.move(width/2,height/2);
      await page.screenshot({path:`artifacts/crt-model-${width}.png`});
      const hero = await page.evaluate(()=>({
        model:window.__sceneDiagnostics.computer,
        ground:window.__sceneDiagnostics.ground,
        resources:performance.getEntriesByType('resource').filter(r=>r.name.includes('/models/')).map(r=>({name:r.name,bytes:r.encodedBodySize,decoded:r.decodedBodySize})),
        overflow:document.documentElement.scrollWidth>innerWidth,
      }));
      await page.evaluate(()=>window.dispatchEvent(new CustomEvent('study-navigate',{detail:.6*window.__sceneDiagnostics.storyHeight})));
      await page.waitForTimeout(1500);
      await page.screenshot({path:`artifacts/crt-entry-${width}.png`});
      results.push({width,height,hero});
    }
  } finally {page.off('pageerror',onError);}
  return {results,errors};
}
