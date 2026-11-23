import { useEffect, useMemo, useState } from 'react';

const files = import.meta.glob('./media/destinations/*.{webm,webp}', { eager: true, query: '?no-inline', import: 'default' });

export const destinationMedia = id => ({
  poster: files['./media/destinations/' + id + '.webp'],
  video: files['./media/destinations/' + id + '.webm'],
});

export function useMediaVisible(ref) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let inView = false;
    const update = () => setVisible(inView && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.intersectionRatio >= .02;
      update();
    }, { threshold: .02 });
    if (ref.current) observer.observe(ref.current);
    document.addEventListener('visibilitychange', update);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); };
  }, [ref]);
  return visible;
}

export function allowsVideo() {
  return !navigator.connection?.saveData && !matchMedia('(prefers-reduced-data: reduce)').matches;
}

export function useVideoPermission() {
  const [permitted, setPermitted] = useState(allowsVideo);
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-data: reduce)');
    function update() { setPermitted(allowsVideo()); }
    preference.addEventListener('change', update);
    navigator.connection?.addEventListener('change', update);
    return () => {
      preference.removeEventListener('change', update);
      navigator.connection?.removeEventListener('change', update);
    };
  }, []);
  return permitted;
}

export function useDestinationFilm(id, enabled, playing) {
  const [visible, setVisible] = useState(() => !document.hidden);
  const permitted = useVideoPermission();
  const [presented, setPresented] = useState(null);
  const film = useMemo(() => {
    if (!enabled || !permitted) return null;
    const { video } = destinationMedia(id);
    if (!video) return null;
    const element = document.createElement('video');
    element.className = 'destination-film destination-live-film';
    element.muted = true;
    element.loop = true;
    element.playsInline = true;
    element.preload = 'none';
    element.setAttribute('aria-hidden', 'true');
    const listeners = new Set();
    return {
      id, element, url: video,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      notify() { for (const listener of listeners) listener(); },
    };
  }, [id, enabled, permitted]);

  useEffect(() => {
    function show() { setVisible(!document.hidden); }
    document.addEventListener('visibilitychange', show);
    return () => document.removeEventListener('visibilitychange', show);
  }, []);

  useEffect(() => {
    if (!film) return;
    const { element } = film;
    return () => {
      element.pause();
      element.remove();
      element.removeAttribute('src');
      element.load();
    };
  }, [film]);

  useEffect(() => {
    if (!film || !playing || !visible) return;
    const { element } = film;
    let active = true;
    let pending;
    let lastFrame = -1;
    let introduced = false;
    const nativeFrames = typeof element.requestVideoFrameCallback === 'function';

    function draw() {
      if (!active) return;
      if (element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && lastFrame !== element.currentTime) {
        lastFrame = element.currentTime;
        if (!introduced) { introduced = true; setPresented(film); }
        film.notify();
      }
      restartFrames();
    }

    function cancelFrame() {
      if (pending === undefined) return;
      if (nativeFrames) element.cancelVideoFrameCallback(pending);
      else cancelAnimationFrame(pending);
      pending = undefined;
    }

    function restartFrames() {
      if (!active) return;
      cancelFrame();
      pending = nativeFrames ? element.requestVideoFrameCallback(draw) : requestAnimationFrame(draw);
    }

    function resume() {
      // Detaching the page surface can pause a video that the visible ring still owns.
      queueMicrotask(() => {
        if (active && element.paused) void element.play().then(restartFrames).catch(() => {});
      });
    }

    element.addEventListener('pause', resume);
    if (!element.getAttribute('src')) element.src = film.url;
    element.play().then(restartFrames).catch(() => {});
    return () => {
      active = false;
      element.removeEventListener('pause', resume);
      element.pause();
      cancelFrame();
    };
  }, [film, playing, visible]);

  return film && film === presented ? film : null;
}
