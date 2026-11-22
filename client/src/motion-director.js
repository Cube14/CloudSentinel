import { useEffect, useMemo } from 'react';
import { gsap } from 'gsap';

const rest = { energy: 0, wipe: 0, shift: 0, critical: 0, sweep: -1 };
const scenes = {
  destination: { energy: .60, shift: -.66, anticipation: .085, release: .54 },
  entrance: { energy: .18, shift: .24, anticipation: .06, release: .74 },
  environment: { energy: .27, shift: -.32, anticipation: .09, release: .60 },
  selection: { energy: .18, shift: .16, anticipation: .04, release: .48 },
  critical: { energy: .67, shift: .48, anticipation: .08, release: .59, critical: 1 },
  scan: { energy: .79, shift: -.57, anticipation: .13, release: .62, sweep: true },
  result: { energy: .34, shift: .11, anticipation: .04, release: .52 },
};

function createDirector() {
  const frame = { ...rest, x: 0, y: 0, aim: 0 };
  const listeners = new Set();
  const timelines = new Map();
  let root;
  let enabled = true;
  let pointerTween;
  let lastImpact = -Infinity;

  function publish() {
    root?.style.setProperty('--motion-energy', frame.energy.toFixed(3));
    root?.style.setProperty('--motion-wipe', frame.wipe.toFixed(3));
    root?.style.setProperty('--motion-shift', frame.shift.toFixed(3));
    for (const listener of listeners) listener();
  }

  function stop(channel) {
    timelines.get(channel)?.kill();
    timelines.delete(channel);
  }

  function sequence(channel, options = {}) {
    stop(channel);
    const timeline = gsap.timeline({ ...options, onComplete: () => timelines.delete(channel) });
    timelines.set(channel, timeline);
    return timeline;
  }

  return {
    frame,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    connect(element, active) {
      root = element;
      enabled = active;
      if (!active) {
        for (const channel of timelines.keys()) stop(channel);
        pointerTween?.kill();
        Object.assign(frame, rest, { x: 0, y: 0, aim: 0 });
      }
      publish();
    },
    play(name) {
      if (!enabled || document.hidden) return;
      const scene = scenes[name];
      if (!scene) return;
      if (name === 'environment' || name === 'scan') stop('result');
      const now = performance.now();
      const accent = scene.energy > .55 && now - lastImpact >= 1200;
      if (accent) lastImpact = now;
      // Keep an in-flight manual sweep when another cue changes the lens.
      const currentSweep = frame.sweep;
      const timeline = sequence('scene', { onUpdate: publish });
      Object.assign(frame, rest, { sweep: currentSweep });
      timeline.addLabel('anticipation').to(frame, { wipe: .37, duration: scene.anticipation, ease: 'power2.in' })
        .addLabel('impact').to(frame, { energy: accent ? scene.energy : Math.min(.34, scene.energy),
          shift: scene.shift, wipe: 1, critical: scene.critical || 0, duration: .075, ease: 'power2.out' })
        .addLabel('recovery').to(frame, { energy: 0, wipe: 0, shift: 0, critical: 0, duration: scene.release, ease: 'power3.out' });
      if (scene.sweep) {
        const wave = { value: -.15 };
        sequence('sweep', { onUpdate: () => { frame.sweep = wave.value; publish(); } })
          .to(wave, { value: 1.13, duration: 1.14, ease: 'power1.inOut', onComplete: () => { frame.sweep = -1; } }, .18);
      }
    },
    result() {
      const delay = Math.max(0, .39 - (timelines.get('scene')?.time() ?? .39));
      sequence('result').call(() => this.play('result'), [], delay);
    },
    reveal(element, selector = '[data-motion-detail]') {
      if (!enabled || !element) return;
      const detail = element.querySelectorAll(selector);
      const tween = gsap.fromTo(element, { '--route-reveal': '.8' }, { '--route-reveal': '0',
        duration: .64, ease: 'power3.out', clearProps: '--route-reveal' });
      const entrance = detail.length > 0 && gsap.fromTo(detail, { y: 7, opacity: .66 }, { y: 0, opacity: 1,
        duration: .34, stagger: .045, clearProps: 'transform,opacity', ease: 'power2.out' });
      return () => { tween.kill(); if (entrance) { entrance.kill(); gsap.set(detail, { clearProps: 'transform,opacity' }); } element.style.removeProperty('--route-reveal'); };
    },
    travel(onUpdate, duration) {
      if (!enabled) { onUpdate(1); return; }
      const value = { progress: 0 };
      sequence('camera', { onUpdate: () => onUpdate(value.progress) })
        .to(value, { progress: 1, duration, ease: 'power3.inOut' });
    },
    stopCamera() { stop('camera'); },
    point(x, y, aim) {
      if (!enabled || document.hidden) return;
      pointerTween?.kill();
      pointerTween = gsap.to(frame, { x, y, aim, duration: .27, ease: 'back.out(1.24)', onUpdate: publish });
    },
    dispose() {
      for (const name of timelines.keys()) stop(name);
      pointerTween?.kill();
      root = null;
    },
  };
}

export function useMotionDirector(root, enabled) {
  const director = useMemo(createDirector, []);
  useEffect(() => { director.connect(root.current, enabled); }, [director, enabled, root]);
  useEffect(() => () => director.dispose(), [director]);
  return director;
}
