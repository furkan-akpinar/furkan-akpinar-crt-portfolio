"use client";

import { useEffect, type RefObject } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import type { SceneRuntime } from './scene/runtime';
import { createIntroGestureState, reduceIntroGesture, introSnapEase } from './scene/intro-gesture';
import { projectAboutWheelSteps } from './scene/project-about-transition';
import { MENU_SIGNAL_DURATION, monitorMenuTransition, type MenuNavigationRequest } from './scene/menu-navigation';
import { sceneScrollTop, storyProgress, SCROLL_SCREENS } from './scene/runtime';
import { getSceneState, type SceneId } from '@/config/scenes';
import { resizeScrollTarget } from './scene/viewport-resize';

gsap.registerPlugin(ScrollTrigger);

interface SmoothScrollProps {
  runtime: RefObject<SceneRuntime>;
  reducedMotion: boolean;
}

export function SmoothScroll({ runtime, reducedMotion }: SmoothScrollProps) {
  useEffect(() => {
    let gesture = createIntroGestureState();
    let lenis: Lenis | null = null;
    let viewport = { width: window.innerWidth, height: window.innerHeight };
    let disposed = false;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    let signalTimeline: gsap.core.Timeline | null = null;
    let pending: MenuNavigationRequest | null = null;
    let committed = false;
    let monitorTarget: SceneId | null = null;

    const arbitrateGesture = (deltaX: number, deltaY: number, event: Event) => {
      // Lenis also reports taps with zero deltas. Cancelling them suppresses
      // the native click, including section selection in the open mobile menu.
      if (deltaX === 0 && deltaY === 0) return true;
      // false bypasses Lenis without cancelling the browser's modifier gesture.
      if (event instanceof WheelEvent && (event.ctrlKey || event.metaKey)) return false;
      if (runtime.current.menuSignalActive || monitorTarget !== null) {
        event.preventDefault();
        return false;
      }
      if (document.querySelector('.experience')?.classList.contains('is-fallback')) return true;

      const wheelSteps = event instanceof WheelEvent
        ? projectAboutWheelSteps(
          event.deltaX,
          event.deltaY,
          event.deltaMode,
          (event as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY,
        )
        : 0;
      const result = reduceIntroGesture(gesture, {
        deltaX,
        deltaY,
        wheelSteps,
        time: performance.now(),
        scroll: window.scrollY,
        viewportHeight: window.innerHeight,
        ready: runtime.current.intro >= 1,
        menuOpen: runtime.current.menuOpen,
      });
      gesture = result.state;
      if (result.action.type === 'pass') return true;

      event.preventDefault();
      if (result.action.type === 'gallery') {
        window.dispatchEvent(new CustomEvent('study-project', { detail: result.action.direction }));
      }
      if (result.action.type === 'snap') {
        if (lenis) {
          lenis.scrollTo(result.action.top, {
            duration: result.action.duration,
            lock: true,
            force: true,
            easing: introSnapEase,
          });
        } else {
          window.scrollTo({ top: result.action.top, behavior: 'instant' });
        }
      }
      if (result.action.type === 'aperture' || result.action.type === 'curl') {
        // A new detent may retarget or reverse immediately; this is not a lock.
        if (lenis) {
          lenis.scrollTo(result.action.top, {
            duration: result.action.duration,
            programmatic: false,
            force: true,
            easing: t => 1 - Math.pow(1 - t, 3),
          });
        } else {
          window.scrollTo({ top: result.action.top, behavior: 'instant' });
        }
      }
      return false;
    };

    if (!reducedMotion) {
      lenis = new Lenis({
        autoRaf: false,
        anchors: false,
        duration: 0.9,
        virtualScroll: ({ deltaX, deltaY, event }) => arbitrateGesture(deltaX, deltaY, event),
      });
    }
    const handleNativeWheel = (event: WheelEvent) => {
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
      arbitrateGesture(event.deltaX * unit, event.deltaY * unit, event);
    };
    if (reducedMotion) window.addEventListener('wheel', handleNativeWheel, { passive: false });

    const advanceScrollClock = (time: number) => lenis?.raf(time * 1000);
    lenis?.on('scroll', ScrollTrigger.update);
    if (lenis) gsap.ticker.add(advanceScrollClock);
    const updateProgress = () => {
      runtime.current.progress = storyProgress(window.scrollY, window.innerHeight);
    };
    const trigger = ScrollTrigger.create({
      start: 0,
      end: () => SCROLL_SCREENS * window.innerHeight,
      onUpdate: updateProgress,
      onRefresh: updateProgress,
    });
    const syncProgress = () => {
      updateProgress();
      ScrollTrigger.update();
    };

    const commitSignalNavigation = () => {
      if (!pending || committed) return;
      committed = true;
      const top = sceneScrollTop(pending.id, window.innerHeight);
      if (lenis) lenis.scrollTo(top, { immediate: true, force: true });
      else window.scrollTo({ top, behavior: 'instant' });
      syncProgress();
    };
    const finishSignalNavigation = () => {
      const id = pending?.id;
      pending = null;
      signalTimeline = null;
      runtime.current.menuSignalActive = false;
      runtime.current.menuSignalProgress = 0;
      gesture = createIntroGestureState();
      lenis?.start();
      window.dispatchEvent(new CustomEvent('study-menu-signal', { detail: { active: false, id } }));
    };
    const completeSignal = () => {
      signalTimeline?.progress(1);
    };
    const handleNavigation = (event: Event) => {
      if (runtime.current.menuSignalActive) return;
      const request = (event as CustomEvent<number | MenuNavigationRequest>).detail;
      const top = typeof request === 'number' ? request : request.top;
      gesture = createIntroGestureState();

      if (typeof request !== 'number' && request.signal) {
        monitorTarget = null;
        pending = request;
        committed = false;
        // Stop any in-flight monitor/scroll journey before the signal covers it.
        lenis?.scrollTo(window.scrollY, { immediate: true, force: true });
        lenis?.stop();
        runtime.current.menuSignalActive = true;
        runtime.current.menuSignalProgress = 0;
        window.dispatchEvent(new CustomEvent('study-menu-signal', { detail: { active: true, id: request.id } }));
        signalTimeline = gsap.timeline({ onComplete: finishSignalNavigation })
          .to(runtime.current, { menuSignalProgress: 1, duration: MENU_SIGNAL_DURATION, ease: 'none' }, 0)
          .call(commitSignalNavigation, [], MENU_SIGNAL_DURATION * .5);
        return;
      }
      if (
        typeof request !== 'number'
        && request.origin === 'menu'
        && !document.querySelector('.experience')?.classList.contains('is-fallback')
      ) {
        // Repeated clicks do not restart the same journey. A reverse click uses
        // the live scroll position with the same curve, even before scene handoff.
        if (monitorTarget === request.id) return;
        const from = monitorTarget ?? getSceneState(storyProgress(window.scrollY, window.innerHeight)).scene.id;
        const journey = monitorMenuTransition(from, request.id, window.innerHeight);
        if (journey) {
          // Cancel a reversal even when no animation frame has moved yet; Lenis
          // otherwise treats the current position as an already-reached target.
          if (monitorTarget !== null) {
            lenis?.stop();
            lenis?.start();
          }
          monitorTarget = request.id;
          if (lenis) {
            lenis.scrollTo(journey.top, {
              duration: journey.duration,
              easing: introSnapEase,
              force: true,
              lock: true,
              onComplete: () => { monitorTarget = null; },
            });
          } else {
            window.scrollTo({ top: journey.top, behavior: 'instant' });
            monitorTarget = null;
          }
          return;
        }
      }

      monitorTarget = null;
      if (lenis) lenis.scrollTo(top, { duration: 1.15, force: true, lock: true });
      else window.scrollTo({ top, behavior: 'instant' });
    };
    window.addEventListener('study-navigate', handleNavigation);
    window.addEventListener('study-navigation-cancel', completeSignal);

    const blockNavigationKey = (event: KeyboardEvent) => {
      if (
        (runtime.current.menuSignalActive || monitorTarget !== null)
        && !event.ctrlKey && !event.metaKey && !event.altKey
        && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)
      ) event.preventDefault();
    };
    const blockNavigationTouch = (event: TouchEvent) => {
      if (
        (runtime.current.menuSignalActive || monitorTarget !== null)
        && event.touches.length === 1
      ) event.preventDefault();
    };
    const handleVisibilityChange = () => {
      if (document.hidden) completeSignal();
    };
    window.addEventListener('keydown', blockNavigationKey);
    window.addEventListener('touchmove', blockNavigationTouch, { passive: false });
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const refreshLayout = () => {
      if (disposed) return;
      const next = { width: window.innerWidth, height: window.innerHeight };
      const top = resizeScrollTarget(window.scrollY, viewport, next);
      if (next.width !== viewport.width || next.height !== viewport.height) gesture = createIntroGestureState();
      viewport = next;
      lenis?.resize();
      if (top !== null) {
        monitorTarget = null;
        if (lenis) lenis.scrollTo(top, { immediate: true, force: true });
        else window.scrollTo({ top, behavior: 'instant' });
      }
      ScrollTrigger.refresh();
      syncProgress();
    };
    const scheduleLayoutRefresh = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(refreshLayout, 150);
    };
    window.addEventListener('resize', scheduleLayoutRefresh);
    window.addEventListener('study-layout-change', scheduleLayoutRefresh);
    document.fonts.ready.then(refreshLayout);
    // The trigger's initial refresh supplies restored scroll progress as well.
    trigger.refresh();

    return () => {
      disposed = true;
      clearTimeout(resizeTimer);
      completeSignal();
      signalTimeline?.kill();
      trigger.kill();
      gsap.ticker.remove(advanceScrollClock);
      lenis?.off('scroll', ScrollTrigger.update);
      lenis?.destroy();
      window.removeEventListener('wheel', handleNativeWheel);
      window.removeEventListener('study-navigate', handleNavigation);
      window.removeEventListener('study-navigation-cancel', completeSignal);
      window.removeEventListener('keydown', blockNavigationKey);
      window.removeEventListener('touchmove', blockNavigationTouch);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('resize', scheduleLayoutRefresh);
      window.removeEventListener('study-layout-change', scheduleLayoutRefresh);
    };
  }, [reducedMotion, runtime]);
  return null;
}