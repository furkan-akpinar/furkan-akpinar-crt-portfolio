"use client";

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { portfolio } from '@/content/portfolio';
import { heroPromptLayout } from './scene/hero-copy-layout';
import { scenes, getSceneState, type SceneId } from '@/config/scenes';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { SmoothScroll } from './smooth-scroll';
import { createRuntime, sceneScrollTop, storyProgress, SCROLL_SCREENS } from './scene/runtime';
import type { RendererStatus } from './scene/types';
import { sampleProjectAbout } from './scene/project-about-transition';
import { navigationLayout, navigationSection, type NavigationLayout, type NavigationRect } from './scene/navigation-layout';
import { shouldUseMenuSignal, type MenuNavigationRequest } from './scene/menu-navigation';
import { contactLayout } from './scene/contact-layout';
import { projectCaptionLayout } from './scene/project-caption-layout';
import { storyViewport } from './scene/viewport-resize';

const SceneCanvas = dynamic(() => import('./scene/scene-canvas'), { ssr: false });
gsap.registerPlugin(useGSAP);

const navigationBounds = (bounds: NavigationRect): CSSProperties => ({
  left: bounds.x,
  top: bounds.y,
  width: bounds.width,
  height: bounds.height
});

const rendererStatusText: Record<RendererStatus, string> = {
  loading: '3D deneyim yükleniyor.',
  webgpu: '3D görünüm hazır.',
  webgl2: '3D görünüm hazır.',
  fallback: 'Metin görünümü etkin.',
};

export function WorkspacePreview() {
  const container = useRef<HTMLDivElement>(null);
  const runtime = useRef(createRuntime());
  const headerRef = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const firstNavigationLink = useRef<HTMLButtonElement>(null);
  const pendingNavigationFocus = useRef<SceneId | null>(null);
  const pendingMenuFocus = useRef(false);
  const projectControls = useRef<HTMLDivElement>(null);
  const contactControls = useRef<HTMLDivElement>(null);
  const introTimeline = useRef<gsap.core.Timeline | null>(null);
  const projectTween = useRef<gsap.core.Timeline | null>(null);
  const [status, setStatus] = useState<RendererStatus>('loading');
  const [booted, setBooted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [activeScene, setActiveScene] = useState<SceneId>('hero');
  const [navigation, setNavigation] = useState<NavigationLayout | null>(null);
  const [projectIndex, setProjectIndex] = useState(0);
  const project = portfolio.projects[projectIndex];
  const repositoryLabel = project.repository === portfolio.github ? 'GitHub profili' : 'GitHub reposu';
  const reducedMotion = useReducedMotion();
  const fallback = status === 'fallback';

  useEffect(() => {
    runtime.current.reducedMotion = reducedMotion;
  }, [reducedMotion]);

  const onStatus = useCallback((value: RendererStatus) => setStatus(value), []);

  const closeMenu = useCallback((restoreFocus = false) => {
    pendingMenuFocus.current = false;
    runtime.current.menuOpen = false;
    runtime.current.hovered = '';
    setMenuOpen(false);
    if (restoreFocus) menuButton.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const handleMenuSignal = (event: Event) => {
      const { active, id } = (event as CustomEvent<{ active: boolean; id?: SceneId; }>).detail;
      if (!active && id) pendingNavigationFocus.current = id;
      setTransitioning(active);
    };
    window.addEventListener('study-menu-signal', handleMenuSignal);
    return () => window.removeEventListener('study-menu-signal', handleMenuSignal);
  }, []);

  useEffect(() => {
    if (fallback) window.dispatchEvent(new Event('study-navigation-cancel'));
  }, [fallback]);

  useLayoutEffect(() => {
    let viewport = { width: window.innerWidth, height: window.innerHeight };
    let contactTravel = 0;
    const touch = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    const resizeStory = () => {
      const scroll = window.scrollY;
      const visible = { width: window.innerWidth, height: window.innerHeight };
      const next = storyViewport(viewport, visible, touch);
      if (next.width !== viewport.width || next.height !== viewport.height) contactTravel = 0;
      viewport = next;
      runtime.current.storyHeight = viewport.height;
      container.current?.style.setProperty('--story-viewport-height', `${viewport.height}px`);
      container.current?.style.setProperty('--visible-viewport-height', `${window.innerHeight}px`);
      // Chrome may shrink a page opened with the toolbar hidden. Reserve enough
      // travel for the footer, but never shrink that range underneath the reader.
      contactTravel = Math.max(contactTravel, contactLayout(visible.width, visible.height).travel);
      container.current?.style.setProperty('--contact-scroll-height', `${Math.ceil(contactTravel) + 3}px`);
      // Capture before changing document height: rotation can otherwise clamp
      // the old position before the scroll owner gets a chance to preserve it.
      window.dispatchEvent(new CustomEvent('study-layout-change', { detail: { scroll } }));
    };
    resizeStory();
    window.addEventListener('resize', resizeStory, { passive: true });
    return () => window.removeEventListener('resize', resizeStory);
  }, []);

  useEffect(() => {
    const measure = document.createElement('canvas').getContext('2d');
    if (!measure) return;
    let disposed = false;
    const measureNavigation = () => {
      if (disposed) return;
      const next = navigationLayout(window.innerWidth, (text, font) => {
        measure.font = font;
        return measure.measureText(text).width;
      }, portfolio.home);
      setNavigation(next);
      if (!next.compact && runtime.current.menuOpen) closeMenu();
    };
    measureNavigation();
    void Promise.all([
      document.fonts.load('500 22px "STIX Two Text"'),
      document.fonts.load('italic 700 31px "STIX Two Text"'),
    ]).then(measureNavigation).catch(measureNavigation);
    window.addEventListener('resize', measureNavigation, { passive: true });
    return () => {
      disposed = true;
      window.removeEventListener('resize', measureNavigation);
    };
  }, [closeMenu]);

  useLayoutEffect(() => {
    if (menuOpen) {
      if (pendingMenuFocus.current) {
        pendingMenuFocus.current = false;
        firstNavigationLink.current?.focus({ preventScroll: true });
      }
    } else if (!transitioning) {
      // React has now removed main's inert attribute, so selection can move
      // focus to its destination without competing with the scroll animation.
      const destination = pendingNavigationFocus.current;
      pendingNavigationFocus.current = null;
      if (destination) document.getElementById(destination)?.focus({ preventScroll: true });
    }
  }, [menuOpen, transitioning]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu(true);
      }
    };
    const closeMenuOnFocusOutside = (event: FocusEvent) => {
      if (event.target instanceof Node && !headerRef.current?.contains(event.target)) closeMenu();
    };
    window.addEventListener('keydown', closeMenuOnEscape);
    document.addEventListener('focusin', closeMenuOnFocusOutside);
    return () => {
      window.removeEventListener('keydown', closeMenuOnEscape);
      document.removeEventListener('focusin', closeMenuOnFocusOutside);
    };
  }, [menuOpen, closeMenu]);

  useGSAP(() => {
    if (status === 'loading') {
      gsap.to(runtime.current, {
        bootProgress: 0.86,
        duration: 1.8,
        ease: 'power2.out',
        overwrite: 'auto'
      });
      return;
    }
    if (status === 'fallback' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      runtime.current.bootProgress = 1;
      runtime.current.intro = 1;
      queueMicrotask(() => setBooted(true));
      return;
    }
    if (booted) return;
    gsap.killTweensOf(runtime.current, 'bootProgress');
    introTimeline.current = gsap.timeline({ defaults: { ease: 'none' }, onComplete: () => setBooted(true) })
      .to(runtime.current, { bootProgress: 1, duration: 0.22 })
      .to(runtime.current, { intro: 1, duration: 0.95 });
    return () => {
      introTimeline.current = null;
    };
  }, { scope: container, dependencies: [status] });

  useEffect(() => {
    const updatePointer = (event: PointerEvent) => {
      runtime.current.pointerX = (event.clientX / window.innerWidth - .5) * 2;
      runtime.current.pointerY = -(event.clientY / window.innerHeight - .5) * 2;
    };
    window.addEventListener('pointermove', updatePointer, { passive: true });
    const resetPointer = () => {
      runtime.current.pointerX = 0;
      runtime.current.pointerY = 0;
    };
    document.documentElement.addEventListener('pointerleave', resetPointer);
    window.addEventListener('blur', resetPointer);
    const syncSceneControls = () => {
      if (!container.current) return;
      const state = getSceneState(storyProgress(window.scrollY, runtime.current.storyHeight));
      const sceneId = fallback
        ? scenes.findLast(scene => (document.getElementById(scene.id)?.getBoundingClientRect().top ?? Infinity) <= 100)?.id ?? 'hero'
        : state.scene.id;
      if (container.current.dataset.activeScene !== sceneId) {
        container.current.dataset.activeScene = sceneId;
        setActiveScene(sceneId);
      }
      container.current.dataset.heroAtRest = String(window.scrollY < 1);
      const aperture = sampleProjectAbout(state.progress);
      container.current.dataset.projectExiting = String(state.scene.id === 'projects' && aperture > 0);
      if (projectControls.current) projectControls.current.inert = !fallback && (state.scene.id !== 'projects' || aperture > 0);
      if (contactControls.current) {
        const layout = contactLayout(window.innerWidth, window.innerHeight, state.localProgress, runtime.current.storyHeight);
        for (const link of contactControls.current.querySelectorAll<HTMLAnchorElement>('a')) {
          const bounds = link.dataset.contactAction === 'github' ? layout.github : layout.invitation;
          Object.assign(link.style, {
            left: `${bounds.x}px`,
            top: `${bounds.y}px`,
            width: `${bounds.width}px`,
            height: `${bounds.height}px`
          });
          link.inert = fallback || sceneId !== 'contact' || bounds.y + bounds.height < 90 || bounds.y > window.innerHeight;
        }
      }
    };
    const positionSceneControls = () => {
      const bounds = heroPromptLayout(window.innerWidth, window.innerHeight);
      for (const key of ['left', 'top', 'width', 'height'] as const) {
        container.current?.style.setProperty(`--hero-cta-${key}`, `${bounds[key]}px`);
      }
      const caption = projectCaptionLayout(window.innerWidth, window.innerHeight);
      for (const link of projectControls.current?.querySelectorAll<HTMLElement>('[data-project-link]') ?? []) {
        const box = link.dataset.projectLink === 'repository' ? caption.repository : caption.website;
        Object.assign(link.style, {
          left: `${box.x}px`,
          top: `${box.y}px`,
          width: `${box.width}px`,
          height: `${box.height}px`
        });
      }
    };
    window.addEventListener('scroll', syncSceneControls, { passive: true });
    window.addEventListener('resize', positionSceneControls, { passive: true });
    window.addEventListener('resize', syncSceneControls, { passive: true });
    syncSceneControls();
    positionSceneControls();
    return () => {
      window.removeEventListener('pointermove', updatePointer);
      window.removeEventListener('scroll', syncSceneControls);
      window.removeEventListener('resize', positionSceneControls);
      window.removeEventListener('resize', syncSceneControls);
      document.documentElement.removeEventListener('pointerleave', resetPointer);
      window.removeEventListener('blur', resetPointer);
    };
  }, [fallback]);

  const navigate = (id: SceneId, origin: 'menu' | 'cta' = 'menu') => {
    if (runtime.current.menuSignalActive) return;
    const source = fallback ? activeScene : getSceneState(runtime.current.progress).scene.id;
    const signal = !fallback && booted && shouldUseMenuSignal(source, id);
    const menuWasOpen = runtime.current.menuOpen;
    pendingNavigationFocus.current = menuWasOpen && !signal ? id : null;
    closeMenu();
    const section = fallback ? document.getElementById(id) : null;
    const top = section ? window.scrollY + section.getBoundingClientRect().top : sceneScrollTop(id, runtime.current.storyHeight);
    window.dispatchEvent(new CustomEvent<MenuNavigationRequest>('study-navigate', {
      detail: {
        top,
        id,
        signal,
        origin
      }
    }));
    if (!menuWasOpen && !signal) document.getElementById(id)?.focus({ preventScroll: true });
  };

  const skipIntro = () => {
    introTimeline.current?.progress(1);
    runtime.current.bootProgress = 1;
    runtime.current.intro = 1;
    setBooted(true);
  };

  const cycle = useCallback((direction: number) => {
    const data = runtime.current;
    const count = portfolio.projects.length;
    data.projectFrom = ((Math.round(data.projectPosition) % count) + count) % count;
    // Retarget from the visible card; rapid input cannot accumulate a stale queue.
    data.projectTarget = Math.round(data.projectPosition) + direction;
    data.projectIndex = data.projectFrom;
    setProjectIndex(data.projectFrom);
    projectTween.current?.kill();
    data.projectMotion = 0;
    const reduced = data.reducedMotion;
    const syncSelection = () => {
      const selected = ((Math.round(data.projectPosition) % count) + count) % count;
      if (selected !== data.projectIndex) {
        data.projectIndex = selected;
        setProjectIndex(selected);
      }
    };
    projectTween.current = gsap.timeline({ onUpdate: syncSelection, onComplete: syncSelection })
      .to(data, {
        projectPosition: data.projectTarget,
        duration: reduced ? 0 : 0.62,
        ease: 'power2.inOut'
      }, 0)
      .to(data, {
        projectMotion: 1,
        duration: reduced ? 0 : 0.62,
        ease: 'none'
      }, 0);
  }, []);

  useEffect(() => {
    let pressed = false, startX = 0, startY = 0;
    const available = () => {
      const state = getSceneState(runtime.current.progress);
      return state.scene.id === 'projects' && sampleProjectAbout(state.progress) === 0 && !runtime.current.menuOpen && !runtime.current.menuSignalActive;
    };
    const choose = (event: Event) => {
      if (available()) cycle((event as CustomEvent<number>).detail);
    };
    const down = (event: PointerEvent) => {
      if (!available() || (event.target as Element).closest('button,a,nav')) return;
      pressed = true;
      startX = event.clientX;
      startY = event.clientY;
    };
    const up = (event: PointerEvent) => {
      if (!pressed) return;
      pressed = false;
      const dx = event.clientX - startX, dy = event.clientY - startY;
      if (available() && Math.abs(dx) > 35 && Math.abs(dx) > Math.abs(dy) * 1.2) cycle(dx < 0 ? 1 : -1);
    };
    const cancel = () => {
      pressed = false;
    };
    const key = (event: KeyboardEvent) => {
      if (!available() || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        cycle(event.key === 'ArrowRight' ? 1 : -1);
      }
    };
    window.addEventListener('study-project', choose);
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
    return () => {
      projectTween.current?.kill();
      window.removeEventListener('study-project', choose);
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
    };
  }, [cycle]);

  const hover = (name: string) => {
    runtime.current.hovered = name;
  };
  const headerContent = portfolio.home;
  const activeSection = navigationSection(activeScene);
  const compact = navigation?.compact ?? true;
  return <div
    ref={container}
    className={`experience ${fallback ? 'is-fallback' : ''} ${booted ? 'is-ready' : 'is-booting'}`}
    data-renderer-status={status}
    data-motion={reducedMotion ? 'reduced' : 'standard'}
    data-menu-transition={transitioning}
  >
    <SmoothScroll
      runtime={runtime}
      reducedMotion={reducedMotion}
    />
    <a
      className="skip-link"
      href="#accessible-content"
      onClick={() => {
        skipIntro();
      }}
    >İçeriğe geç</a>
    {!fallback && <div className="fixed-stage">
      <SceneCanvas
        onStatus={onStatus}
        runtime={runtime}
      />
    </div>}
    {status === 'loading' && <span
      className="sr-only"
      role="status"
    >
      {portfolio.boot.version}
    </span>}
    {transitioning && <div
      className="navigation-shield"
      aria-hidden="true"
    />}
    {menuOpen && <div
      className="menu-backdrop"
      aria-hidden="true"
      onPointerDown={() => closeMenu()}
    />}
    <header
      ref={headerRef}
      className="semantic-header"
      data-compact={compact}
      data-layout-ready={!!navigation}
      style={{ height: navigation?.height }}
      aria-label="Ana gezinme"
      inert={transitioning || (!booted && !fallback)}
    >
      <button
        className="logo-control"
        style={navigation ? { ...navigationBounds(navigation.logo), font: navigation.brandFont } : undefined}
        aria-label={`${headerContent.name} — Ana Sayfa`}
        onClick={() => navigate('hero')}
      >
        {headerContent.name}
      </button>
      <button
        ref={menuButton}
        className="menu-control"
        style={navigation ? navigationBounds(navigation.menu) : undefined}
        hidden={!compact}
        aria-label={menuOpen ? 'Menüyü kapat' : 'Menüyü aç'}
        aria-controls="section-navigation"
        aria-expanded={menuOpen}
        onClick={event => {
          if (menuOpen) {
            closeMenu();
            return;
          }
          pendingMenuFocus.current = event.detail === 0;
          runtime.current.menuOpen = true;
          setMenuOpen(true);
        }}
      >
        <span
          aria-hidden="true"
          className="menu-glyph"
        >
          <i />
          <i />
          <i />
        </span>
      </button>
      <nav
        id="section-navigation"
        className={`navigation ${menuOpen ? 'menu-is-open' : ''}`}
        hidden={compact && !menuOpen}
        aria-label="Bölümler"
      >
        {compact && navigation && <span
          className="fallback-menu-panel"
          aria-hidden="true"
          style={navigationBounds(navigation.popup)}
        />}
        {headerContent.nav.map((item, index) => <button
          ref={index === 0 ? firstNavigationLink : undefined}
          key={item.target}
          style={navigation ? { ...navigationBounds(navigation.links[index].bounds), font: navigation.font } : undefined}
          aria-current={activeSection === item.target ? 'location' : undefined}
          onPointerEnter={() => hover(item.target)}
          onPointerLeave={() => hover('')}
          onFocus={() => hover(item.target)}
          onBlur={() => hover('')}
          onClick={() => navigate(item.target as SceneId)}
        >
          {item.label}
        </button>)}
      </nav>
      <button
        className="contact-control"
        style={navigation ? { ...navigationBounds(navigation.call.bounds), font: navigation.callFont } : undefined}
        hidden={compact}
        onPointerEnter={() => hover('contact-cta')}
        onPointerLeave={() => hover('')}
        onFocus={() => hover('contact-cta')}
        onBlur={() => hover('')}
        onClick={() => navigate('contact')}
      >
        {headerContent.callLabel}
      </button>
    </header>
    <main
      id="accessible-content"
      className="scroll-story"
      inert={menuOpen || transitioning}
    >
      {scenes.map((scene, index) => <section
        id={scene.id}
        tabIndex={-1}
        key={scene.id}
        className={`scene-section scene-${scene.id}`}
        style={{ height: scene.id === 'contact' ? 'var(--contact-scroll-height, 3px)' : `calc(${(scene.end - scene.start) * SCROLL_SCREENS} * var(--story-viewport-height, 100vh))` }}
        aria-labelledby={`${scene.id}-title`}
      >
        <div className="semantic-copy">
          {index === 0 ? <h1 id={`${scene.id}-title`}>
            {portfolio.title}
          </h1> : <h2 id={`${scene.id}-title`}>
            {scene.label}
          </h2>}
          {index === 0 ? null : index === 1 ? <>
            <p>{portfolio.projectsIntro}</p>
            <h3>{portfolio.projects[projectIndex].title}</h3>
          </> : scene.id === 'about-us' ? <>
            {portfolio.about.paragraphs.map(paragraph => <p key={paragraph}>
              {paragraph}
            </p>)}
            <h3>{portfolio.about.technologiesTitle.join(' ')}</h3>
            <p>{portfolio.about.technologiesDescription}</p>
            <p>{portfolio.about.technologies.join(' · ')}</p>
            <h3>{portfolio.about.toolsLabel}</h3>
            <p>{portfolio.about.tools.join(' · ')}</p>
            <h3>{portfolio.about.closingHeadline.join(' ')}</h3>
            <p>{portfolio.about.closingParagraph}</p>
          </> : scene.id === 'contact' ? <>
            <h3>{portfolio.reveal.lines.join(' ')}</h3>
            <p>{portfolio.reveal.description}</p>
            {portfolio.contact.columns.map(column => <div key={column.title}>
              <h3>{column.title}</h3>
              <p>{column.lines.join(' · ')}</p>
            </div>)}
            <h3>{portfolio.contact.businessTitle}</h3>
            <p>{portfolio.contact.businessDescription}</p>
            <a href={portfolio.github}>GitHub · furkan-akpinar</a>
            <footer>
              <h3>{portfolio.name}</h3>
              <p>{portfolio.contact.footerTagline}</p>
              <p>{portfolio.contact.footerNotice}</p>
            </footer>
          </> : <p>
            {portfolio.reveal.description}
          </p>}
          {index === 0 && <button onClick={() => navigate('projects', 'cta')}>
            {portfolio.prompt}
          </button>}
        </div>
        {index === 1 && <div
          ref={projectControls}
          className="project-controls"
        >
          <button
            aria-label="Önceki proje"
            onClick={() => cycle(-1)}
          >Önceki proje</button>
          <a
            className="project-link"
            data-project-link="repository"
            href={project.repository}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${project.title} — ${repositoryLabel}`}
          >
            {repositoryLabel}
          </a>
          <a
            className="project-link"
            data-project-link="website"
            href={project.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${project.title} — Web sitesi`}
          >Web sitesi →</a>
          <span
            className="sr-only"
            aria-live="polite"
          >
            {portfolio.projects[projectIndex].title}
          </span>
          <button
            aria-label="Sonraki proje"
            onClick={() => cycle(1)}
          >Sonraki proje</button>
        </div>}
        {scene.id === 'contact' && <div
          ref={contactControls}
          className="contact-actions"
        >
          <a
            data-contact-action="github"
            href={portfolio.github}
            aria-label="GitHub üzerinden furkan-akpinar ile iletişim"
          />
          <a
            data-contact-action="invitation"
            href={portfolio.github}
            aria-label={`${portfolio.contact.businessTitle} GitHub profilini aç`}
          />
        </div>}
      </section>)}
      <div
        className="last-viewport"
        aria-hidden="true"
      />
    </main>
    {booted && !fallback && <button
      className="hero-scroll-control"
      inert={menuOpen}
      onClick={() => navigate('projects', 'cta')}
    >
      {portfolio.prompt}
    </button>}
    {fallback && <aside
      className="fallback-notice"
      role="status"
    >
      <strong>3D görüntü bu tarayıcıda başlatılamadı.</strong>
      <p>İçerik ve bölüm bağlantıları kullanılabilir.</p>
      <button onClick={() => {
        window.history.replaceState(null, '', '/');
        window.location.reload();
      }}>Grafikleri yeniden dene</button>
    </aside>}
    <span
      className="sr-only"
      data-testid="renderer-status"
      data-status={status}
      role="status"
    >
      {rendererStatusText[status]}
    </span>
  </div>;
}
