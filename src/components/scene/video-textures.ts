import * as THREE from 'three/webgpu';

const LOAD_TIMEOUT = 30_000;

/**
 * Video textures with a shared loading contract and explicit playback ownership.
 * Each video decodes its first frame before ready resolves, even while paused.
 */
export function createVideoTextures(sources: readonly string[]) {
  if (sources.length === 0) throw new Error('Video textures require at least one clip.');
  const videos: HTMLVideoElement[] = [];
  const textures: THREE.VideoTexture[] = [];
  const wanted = new Uint8Array(sources.length);
  const loaded = new Uint8Array(sources.length);
  // 0 = paused, 1 = play promise pending, 2 = playing, 3 = browser autoplay blocked.
  const playback = new Uint8Array(sources.length);
  const playAttempt = new Uint32Array(sources.length);
  const listeners: Array<{ data: () => void; error: () => void }> = [];
  const diagnostics = {
    source: 'video-textures',
    readyCount: 0,
    total: sources.length,
    playing: [] as number[],
    blocked: [] as number[],
    currentTimes: Array<number>(sources.length).fill(0),
    error: null as string | null,
  };
  let disposed = false;
  let settled = false;
  let gestureListener = false;
  let failure: Error | null = null;
  let resolveReady: () => void;
  let rejectReady: (reason: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  function removeGestureListener() {
    if (!gestureListener) return;
    window.removeEventListener('pointerdown', retryBlocked);
    window.removeEventListener('keydown', retryBlocked);
    gestureListener = false;
  }

  function addGestureListener() {
    if (gestureListener || disposed) return;
    window.addEventListener('pointerdown', retryBlocked, { passive: true });
    window.addEventListener('keydown', retryBlocked);
    gestureListener = true;
  }

  function fail(error: Error) {
    if (disposed || failure) return;
    failure = error;
    diagnostics.error = error.message;
    clearTimeout(timeout);
    wanted.fill(0);
    for (const video of videos) video.pause();
    removeGestureListener();
    if (!settled) {
      settled = true;
      rejectReady(error);
    }
  }

  function start(index: number) {
    if (disposed || failure || !wanted[index] || !loaded[index] || playback[index] === 1 || playback[index] === 3) return;
    const video = videos[index];
    if (!video.paused && playback[index] === 2) return;
    playback[index] = 1;
    const attempt = ++playAttempt[index];
    void video.play().then(() => {
      if (attempt !== playAttempt[index]) return;
      if (disposed || !wanted[index]) {
        video.pause();
        playback[index] = 0;
        return;
      }
      playback[index] = 2;
    }).catch((reason: unknown) => {
      if (disposed || attempt !== playAttempt[index]) return;
      const name = reason instanceof Error ? reason.name : '';
      // A quick direction change can pause a clip before its play promise resolves.
      if (!wanted[index] || name === 'AbortError') {
        playback[index] = 0;
        return;
      }
      if (name === 'NotAllowedError') {
        playback[index] = 3;
        addGestureListener();
        return;
      }
      playback[index] = 0;
      fail(new Error(`Video playback failed: ${sources[index]}`, { cause: reason }));
    });
  }

  function retryBlocked() {
    removeGestureListener();
    for (let index = 0; index < videos.length; index++) {
      if (playback[index] !== 3) continue;
      playback[index] = 0;
      if (wanted[index]) start(index);
    }
  }

  const timeout = setTimeout(() => {
    const missing = sources.filter((_, index) => !loaded[index]);
    fail(new Error(`Timed out decoding initial video frames: ${missing.join(', ')}`));
  }, LOAD_TIMEOUT);

  for (let index = 0; index < sources.length; index++) {
    const video = document.createElement('video');
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.loop = true;
    video.preload = 'auto';
    video.controls = false;
    video.disablePictureInPicture = true;
    video.setAttribute('playsinline', '');
    const map = new THREE.VideoTexture(video);
    map.name = `video-texture-${index}`;
    map.colorSpace = THREE.SRGBColorSpace;
    map.minFilter = map.magFilter = THREE.LinearFilter;
    map.generateMipmaps = false;
    videos.push(video);
    textures.push(map);
    const data = () => {
      if (disposed || failure || loaded[index] || video.readyState < 2) return;
      loaded[index] = 1;
      diagnostics.readyCount++;
      // A paused video may not schedule a presentation callback; upload its decoded still.
      map.needsUpdate = true;
      if (diagnostics.readyCount === sources.length && !settled) {
        clearTimeout(timeout);
        settled = true;
        resolveReady();
      }
      if (wanted[index]) start(index);
    };
    const error = () => fail(new Error(
      `Cannot decode video ${sources[index]} (media error ${video.error?.code ?? 'unknown'}).`,
    ));
    listeners.push({ data, error });
    video.addEventListener('loadeddata', data);
    video.addEventListener('error', error);
    video.src = sources[index];
    video.load();
  }

  function update(indices: readonly number[], paused = false) {
    if (disposed) return;
    if (failure) throw failure;
    wanted.fill(0);
    if (!paused) {
      for (let slot = 0; slot < indices.length; slot++) {
        const index = indices[slot];
        if (Number.isInteger(index) && index >= 0 && index < sources.length) wanted[index] = 1;
      }
    }
    diagnostics.playing.length = 0;
    diagnostics.blocked.length = 0;
    for (let index = 0; index < videos.length; index++) {
      const video = videos[index];
      if (wanted[index]) {
        start(index);
      } else if (playback[index] !== 0 || !video.paused) {
        playAttempt[index]++;
        video.pause();
        playback[index] = 0;
      }
      diagnostics.currentTimes[index] = video.currentTime;
      if (!video.paused) diagnostics.playing.push(index);
      if (playback[index] === 3) diagnostics.blocked.push(index);
    }
    if (diagnostics.blocked.length === 0) removeGestureListener();
  }

  return {
    textures, videos, ready, diagnostics, update,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timeout);
      removeGestureListener();
      wanted.fill(0);
      // Settle abandoned initialization without a stale rejection after unmount.
      if (!settled) { settled = true; resolveReady(); }
      for (let index = 0; index < videos.length; index++) {
        const video = videos[index];
        video.removeEventListener('loadeddata', listeners[index].data);
        video.removeEventListener('error', listeners[index].error);
        video.pause();
        textures[index].dispose();
        video.removeAttribute('src');
        video.load();
        video.remove();
      }
      diagnostics.playing.length = 0;
      diagnostics.blocked.length = 0;
    },
  };
}
