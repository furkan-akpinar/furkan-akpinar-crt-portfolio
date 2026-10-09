async page => {
  const baseURL = new URL(page.url()).origin;
  const originalViewport = page.viewportSize();
  const checks = [], errors = [], failed = [], screenshots = [];
  const projects = [
    ['KARAKTER STÜDYO', 'https://github.com/furkan-akpinar/karakter-studyo', 'https://karakter-studyo.furkan-akpinar.workers.dev/'],
    ['KIPIR', 'https://github.com/furkan-akpinar/kipir-studio', 'https://kipir-studio.furkan-akpinar.workers.dev/'],
    ['Snow Medya', 'https://github.com/furkan-akpinar/snow-medya', 'https://snow-medya.furkan-akpinar.workers.dev/'],
    ['Ezo Eylül Sağır', 'https://github.com/furkan-akpinar/ezo-eylul-sagir-interactive', 'https://furkan-akpinar.github.io/ezo-eylul-sagir-interactive/'],
    ['VANTA DRIVE', 'https://github.com/furkan-akpinar/vanta-drive', 'https://vanta-drive.furkan-akpinar.workers.dev/'],
    ['KOME', 'https://github.com/furkan-akpinar', 'https://kome-japanese-culture.furkan-akpinar.workers.dev/'],
    ['Furkan Akpınar · Dijital Ajans', 'https://github.com/furkan-akpinar/furkan-akpinar-dijital-ajans', 'https://furkan-akpinar-dijital-ajans.furkan-akpinar.workers.dev/'],
  ];
  const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail });
  const near = (actual, expected) => Math.abs(actual - expected) < 0.6;
  const onPageError = error => errors.push(error.message);
  const onResponse = response => {
    if (response.status() >= 400 && response.url().startsWith(baseURL + '/')) {
      failed.push({ url: response.url(), status: response.status() });
    }
  };
  page.on('pageerror', onPageError);
  page.on('response', onResponse);

  const snapshot = () => page.evaluate(() => ({
    scene: window.__sceneDiagnostics?.scene,
    titleWave: window.__sceneDiagnostics?.projectTitle,
    activeIndex: window.__sceneDiagnostics?.ring.activeIndex,
    name: document.querySelector('.project-controls .sr-only')?.textContent,
    canvasCount: document.querySelectorAll('.scene-canvas canvas').length,
    overflow: document.documentElement.scrollWidth > innerWidth,
    links: Array.from(document.querySelectorAll('[data-project-link]'), element => {
      const box = element.getBoundingClientRect();
      const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return {
        type: element.getAttribute('data-project-link'), href: element.getAttribute('href'),
        x: box.x, y: box.y, width: box.width, height: box.height,
        hit: target === element || element.contains(target),
      };
    }),
  }));
  const capture = async name => {
    const path = `artifacts/project-title-${name}.png`;
    await page.screenshot({ path });
    screenshots.push(path);
  };
  const ready = async (width, height) => {
    await page.setViewportSize({ width, height });
    await page.goto(baseURL + '/?renderer=webgl');
    // Title/layout regression timing starts once deferred destination assets
    // are ready; startup.js covers navigation requests during their loading.
    await page.waitForFunction(() => document.querySelector('.is-ready') && window.__sceneDiagnostics?.intro === 1
      && window.__sceneDiagnostics.contentReady === true, null, { timeout: 120000 });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('study-navigate', {
      detail: 1.42 * window.__sceneDiagnostics.storyHeight,
    })));
    await page.waitForFunction(() => window.__sceneDiagnostics?.scene === 'projects'
      && window.__sceneDiagnostics.travel === 1, null, { timeout: 15000 });
    // The camera and incoming caption have independent entry easing.
    await page.waitForTimeout(1500);
  };
  const next = async index => {
    await page.getByRole('button', { name: 'Sonraki proje', exact: true }).click();
    await page.waitForFunction(index => window.__sceneDiagnostics?.projectMotion === 1
      && window.__sceneDiagnostics.ring.activeIndex === index, index, { timeout: 15000 });
  };
  const verifyLinks = (state, index) => state.links.length === 2
    && state.links.find(link => link.type === 'repository')?.href === projects[index][1]
    && state.links.find(link => link.type === 'website')?.href === projects[index][2];

  try {
    await page.bringToFront();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    for (const [width, height] of [[1440, 900], [390, 844], [320, 568], [768, 1024]]) {
      await ready(width, height);
      const initial = await snapshot();
      const mobile = width < 900;
      check(`${width}: one scene canvas and no horizontal overflow`, initial.canvasCount === 1 && !initial.overflow, initial);
      check(`${width}: title wave only on responsive layout`, initial.titleWave?.enabled === mobile, initial.titleWave);
      const expectedTop = mobile ? 193.5 : height * 0.288 - 20 - 10;
      const expectedWidth = mobile ? 132 : 158;
      const gap = mobile ? 20 : 30;
      check(`${width}: visible caption and semantic links share the raised position`, initial.links.length === 2
        && initial.links.every(link => near(link.y, expectedTop) && near(link.width, expectedWidth)
          && near(link.height, 44) && link.hit)
        && near(initial.links.find(link => link.type === 'repository')?.x, width / 2 - gap / 2 - expectedWidth)
        && near(initial.links.find(link => link.type === 'website')?.x, width / 2 + gap / 2), initial.links);
      await page.waitForTimeout(250);
      const animated = await snapshot();
      check(`${width}: visible responsive wave advances; desktop remains still`, mobile
        ? animated.titleWave?.phase > initial.titleWave?.phase
        : animated.titleWave?.phase === initial.titleWave?.phase, { before: initial.titleWave, after: animated.titleWave });

      if (!mobile) {
        check('desktop: first project name and URLs preserved', initial.name === projects[0][0] && verifyLinks(initial, 0), initial);
        await capture('1440-desktop');
        continue;
      }

      const names = [];
      for (let index = 0; index < projects.length; index++) {
        const state = await snapshot();
        names.push(state.name);
        check(`${width}: project ${index + 1} name, URLs and live hitboxes`, state.name === projects[index][0]
          && state.activeIndex === index && verifyLinks(state, index)
          && state.links.every(link => link.hit && near(link.y, 193.5)) && !state.overflow, state);
        if (width === 390 || index === projects.length - 1) await capture(`${width}-${index + 1}`);
        if (index < projects.length - 1) await next(index + 1);
      }
      check(`${width}: complete ordered set`, JSON.stringify(names) === JSON.stringify(projects.map(project => project[0])), names);
    }

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await ready(390, 844);
    const reducedBefore = await snapshot();
    await page.waitForTimeout(250);
    const reducedAfter = await snapshot();
    check('reduced motion disables and freezes the responsive title wave', reducedBefore.titleWave?.enabled === false
      && reducedAfter.titleWave?.enabled === false && reducedBefore.titleWave?.phase === reducedAfter.titleWave?.phase,
    { before: reducedBefore.titleWave, after: reducedAfter.titleWave });
    check('reduced motion retains project links and one canvas', reducedAfter.canvasCount === 1
      && verifyLinks(reducedAfter, 0) && reducedAfter.links.every(link => link.hit), reducedAfter);
    await capture('390-reduced-motion');
    check('no page errors or failed same-origin assets', errors.length === 0 && failed.length === 0, { errors, failed });
    check('all planned responsive title stages completed', true);
  } catch (error) {
    check('all planned responsive title stages completed', false, String(error));
  } finally {
    page.off('pageerror', onPageError);
    page.off('response', onResponse);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
  return { passed: checks.filter(result => result.pass).length, total: checks.length, checks, errors, failed, screenshots };
}
