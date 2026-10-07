import gsap from 'gsap';

export interface ScrollToOptions {
  duration?: number;
  immediate?: boolean;
  force?: boolean;
  lock?: boolean;
  easing?: (progress: number) => number;
  programmatic?: boolean;
  onComplete?: () => void;
}

export interface ScrollDriver {
  scrollTo(top: number, options?: ScrollToOptions): void;
  stop(): void;
  start(): void;
  resize(): void;
  destroy(): void;
}

export interface MobileScrollOptions {
  target: HTMLElement;
  read: () => number;
  write: (position: number) => void;
  limit: () => number;
  reducedMotion: boolean;
  /** False means the existing scene gesture owner consumed this input. */
  arbitrate: (deltaX: number, deltaY: number, event: Event) => boolean;
}

export function clampMobileScroll(position: number, limit: number): number {
  const end = Number.isFinite(limit) ? Math.max(0, limit) : 0;
  return Math.max(0, Math.min(end, Number.isFinite(position) ? position : 0));
}

/** Ignore finger jitter before choosing one owner for the rest of the drag. */
export function mobileScrollAxis(dx: number, dy: number): 'x' | 'y' | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.max(Math.abs(dx), Math.abs(dy)) < 4) return null;
  return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
}

/** Short, bounded continuation; a held finger or reverse movement never reuses stale momentum. */
export function mobileScrollMomentum(position: number, velocity: number, idleMs: number, limit: number) {
  const from = clampMobileScroll(position, limit);
  if (!Number.isFinite(velocity) || !Number.isFinite(idleMs) || idleMs < 0 || idleMs > 100 || Math.abs(velocity) < 0.08) {
    return { top: from, duration: 0 };
  }
  const speed = Math.max(-1.25, Math.min(1.25, velocity));
  const top = clampMobileScroll(from + speed * 160, limit);
  return { top, duration: top === from ? 0 : 0.34 };
}

type Finger = {
  id: number;
  startX: number;
  startY: number;
  lastY: number;
  lastTime: number;
  lastMovement: number;
  velocity: number;
  axis: 'x' | 'y' | null;
  consumed: boolean;
};

/** Owns numeric scene distance only. It never reads or writes document scroll. */
export function createMobileScroll({ target, read, write, limit, reducedMotion, arbitrate }: MobileScrollOptions): ScrollDriver {
  let stopped = false;
  let destroyed = false;
  let locked = false;
  let animation: gsap.core.Tween | null = null;
  let finger: Finger | null = null;
  const position = () => clampMobileScroll(read(), limit());
  const setPosition = (value: number) => write(clampMobileScroll(value, limit()));
  const prevent = (event: Event) => { if (event.cancelable) event.preventDefault(); };
  const zoomed = () => Math.abs((window.visualViewport?.scale ?? 1) - 1) > 0.01;
  const visualViewport = window.visualViewport;
  const ownerDocument = target.ownerDocument;

  function cancelAnimation() {
    animation?.kill();
    animation = null;
    locked = false;
  }

  function scrollTo(top: number, options: ScrollToOptions = {}) {
    if (destroyed || !Number.isFinite(top) || ((stopped || locked) && !options.force)) return;
    if (options.lock && finger) finger.consumed = true;
    cancelAnimation();
    const destination = clampMobileScroll(top, limit());
    const duration = Number.isFinite(options.duration) ? Math.max(0, options.duration!) : 0.9;
    if (options.immediate || reducedMotion || duration === 0 || destination === position()) {
      setPosition(destination);
      options.onComplete?.();
      return;
    }
    locked = Boolean(options.lock);
    const state = { position: position() };
    animation = gsap.to(state, {
      position: destination,
      duration,
      ease: options.easing ?? (progress => 1 - Math.pow(1 - progress, 3)),
      onUpdate: () => setPosition(state.position),
      onComplete: () => {
        animation = null;
        locked = false;
        setPosition(destination);
        options.onComplete?.();
      },
    });
  }

  function touchStart(event: TouchEvent) {
    if (zoomed() || event.touches.length !== 1) {
      finger = null;
      if (!locked) cancelAnimation();
      return;
    }
    if (!locked) cancelAnimation();
    const touch = event.touches[0];
    const now = performance.now();
    finger = { id: touch.identifier, startX: touch.clientX, startY: touch.clientY,
      lastY: touch.clientY, lastTime: now, lastMovement: now, velocity: 0, axis: null, consumed: locked || stopped };
  }

  function touchMove(event: TouchEvent) {
    if (zoomed() || !finger || event.touches.length !== 1) {
      finger = null;
      if (!locked) cancelAnimation();
      return; // Preserve native pinch/zoom and never resume midway through it.
    }
    const touch = event.touches[0];
    if (touch.identifier !== finger.id) return;
    finger.axis ??= mobileScrollAxis(touch.clientX - finger.startX, touch.clientY - finger.startY);
    if (!finger.axis) return;
    prevent(event);
    const now = performance.now();
    const deltaY = finger.lastY - touch.clientY;
    const elapsed = Math.max(8, now - finger.lastTime);
    finger.lastY = touch.clientY;
    finger.lastTime = now;
    // Horizontal project swipes belong exclusively to WorkspacePreview's
    // pointerup handler. Do not also dispatch the reducer's gallery action.
    if (finger.consumed || finger.axis === 'x' || stopped || locked) {
      finger.velocity = 0;
      return;
    }
    if (deltaY === 0) return;
    if (!arbitrate(0, deltaY, event)) {
      finger.velocity = 0;
      return;
    }
    const previous = position();
    setPosition(previous + deltaY);
    const speed = (position() - previous) / elapsed;
    finger.velocity = speed * finger.velocity <= 0 ? speed : finger.velocity * 0.35 + speed * 0.65;
    finger.lastMovement = now;
  }

  function touchEnd(event: TouchEvent) {
    const released = finger;
    finger = null;
    if (!released || released.consumed || zoomed() || event.touches.length > 0 || released.axis !== 'y' || stopped || locked || reducedMotion) return;
    const momentum = mobileScrollMomentum(position(), released.velocity, performance.now() - released.lastMovement, limit());
    if (momentum.duration) scrollTo(momentum.top, { duration: momentum.duration, programmatic: false });
  }

  function touchCancel() { finger = null; }

  function suspendInput() {
    finger = null;
    // Menu/monitor transitions own completion callbacks; only free movement
    // and release momentum are cancelled when focus leaves the page.
    if (!locked) cancelAnimation();
  }
  function visibilityChanged() { if (ownerDocument.hidden) suspendInput(); }
  function syncNativeZoom() {
    target.dataset.nativeZoom = String(zoomed());
    if (zoomed()) suspendInput();
  }

  function wheel(event: WheelEvent) {
    if (event.ctrlKey || event.metaKey || event.defaultPrevented) return;
    if (!event.deltaX && !event.deltaY) return;
    prevent(event);
    if (stopped || locked) return;
    cancelAnimation();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? target.clientHeight : 1;
    const dx = event.deltaX * unit, dy = event.deltaY * unit;
    if (arbitrate(dx, dy, event) && Math.abs(dy) >= Math.abs(dx)) setPosition(position() + dy);
  }

  function keyboard(event: KeyboardEvent) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || (event.shiftKey && event.key !== ' ')) return;
    const source = event.target instanceof Element ? event.target : null;
    if (source?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]')) return;
    if (event.key === ' ' && source?.closest('button,[role="button"]')) return;
    const current = position(), pageSize = Math.max(1, target.clientHeight * 0.85);
    const destination = event.key === 'ArrowDown' ? current + 48
      : event.key === 'ArrowUp' ? current - 48
      : event.key === 'PageDown' ? current + pageSize
      : event.key === 'PageUp' ? current - pageSize
      : event.key === ' ' ? current + (event.shiftKey ? -pageSize : pageSize)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? limit()
      : null;
    if (destination === null) return;
    prevent(event);
    if (stopped || locked) return;
    cancelAnimation();
    if (arbitrate(0, destination - current, event)) scrollTo(destination, { duration: 0.24, programmatic: false });
  }

  target.addEventListener('touchstart', touchStart, { passive: true });
  target.addEventListener('touchmove', touchMove, { passive: false });
  target.addEventListener('touchend', touchEnd, { passive: true });
  target.addEventListener('touchcancel', touchCancel, { passive: true });
  target.addEventListener('wheel', wheel, { passive: false });
  window.addEventListener('keydown', keyboard);
  window.addEventListener('blur', suspendInput);
  ownerDocument?.addEventListener('visibilitychange', visibilityChanged);
  visualViewport?.addEventListener('resize', syncNativeZoom);
  syncNativeZoom();

  return {
    scrollTo,
    stop() { stopped = true; finger = null; cancelAnimation(); },
    start() { if (!destroyed) stopped = false; },
    resize() { if (!destroyed) { finger = null; cancelAnimation(); setPosition(position()); } },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      finger = null;
      cancelAnimation();
      target.removeEventListener('touchstart', touchStart);
      target.removeEventListener('touchmove', touchMove);
      target.removeEventListener('touchend', touchEnd);
      target.removeEventListener('touchcancel', touchCancel);
      target.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', keyboard);
      window.removeEventListener('blur', suspendInput);
      ownerDocument?.removeEventListener('visibilitychange', visibilityChanged);
      visualViewport?.removeEventListener('resize', syncNativeZoom);
      delete target.dataset.nativeZoom;
    },
  };
}
