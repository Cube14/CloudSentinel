import { useEffect, useMemo, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { destinations, nearestOffset, phases, wrapIndex } from './carousel-state';

export function useCarouselDirector(route, navigate, enabled) {
  const [page, setPage] = useState(route);
  const [selected, setSelected] = useState(() => route ? destinations.indexOf(route) : 0);
  const [phase, setPhase] = useState(() => route ? phases.page : phases.idle);
  const live = useRef({ route, navigate, enabled });
  live.current = { route, navigate, enabled };
  const machine = useMemo(() => {
    const initial = live.current.route;
    const frame = { offset: initial ? destinations.indexOf(initial) : 0, travel: initial ? 1 : 0, cover: initial ? 1 : 0, accent: 0 };
    let currentPage = initial;
    let currentPhase = initial ? phases.page : phases.idle;
    let index = wrapIndex(frame.offset);
    let goal = frame.offset;
    let tween;
    const listeners = new Set();

    function publish() {
      const next = wrapIndex(frame.offset);
      if (next !== index) { index = next; setSelected(next); }
      for (const listener of listeners) listener();
    }

    function changePhase(next) { currentPhase = next; setPhase(next); }
    function changePage(next) { currentPage = next; setPage(next); }
    function locked() { return ![phases.idle, phases.rotating, phases.selected].includes(currentPhase); }
    function stop() { tween?.kill(); tween = null; }

    function snap(destination, duration) {
      stop();
      goal = destination;
      if (!live.current.enabled) {
        frame.offset = destination;
        publish();
        changePhase(phases.selected);
        return;
      }
      changePhase(phases.rotating);
      tween = gsap.to(frame, { offset: destination, duration, ease: 'power3.out', onUpdate: publish,
        onComplete: () => changePhase(phases.selected) });
    }

    function completeEntry(next, updateRoute) {
      changePage(next);
      changePhase(phases.page);
      if (updateRoute) live.current.navigate('/workspace/' + next.id);
    }

    function enter(next, updateRoute) {
      stop();
      changePhase(phases.entering);
      goal = nearestOffset(frame.offset, destinations.indexOf(next));
      if (!live.current.enabled) {
        Object.assign(frame, { offset: goal, travel: 1, cover: 1, accent: 0 });
        publish();
        completeEntry(next, updateRoute);
        return;
      }
      tween = gsap.timeline({ onUpdate: publish, onComplete: () => completeEntry(next, updateRoute) });
      tween.to(frame, { offset: goal, travel: -.075, duration: .16, ease: 'power2.out' })
        .to(frame, { travel: 1, duration: .74, ease: 'power3.inOut' })
        .to(frame, { accent: .65, duration: .12, ease: 'power2.out' }, .60)
        .to(frame, { accent: 0, duration: .26, ease: 'power2.out' }, .72)
        .call(() => changePage(next), [], .70)
        .to(frame, { cover: 1, duration: .28, ease: 'power3.inOut' }, .70);
    }

    function leave(updateRoute) {
      stop();
      changePhase(phases.exiting);
      function finish() {
        changePage(null);
        changePhase(phases.idle);
        if (updateRoute) live.current.navigate('/workspace');
      }
      if (!live.current.enabled) {
        Object.assign(frame, { travel: 0, cover: 0, accent: 0 });
        publish();
        finish();
        return;
      }
      tween = gsap.timeline({ onUpdate: publish, onComplete: finish });
      tween.to(frame, { cover: 0, duration: .24, ease: 'power2.in' })
        .call(() => { changePage(null); changePhase(phases.returning); })
        .to(frame, { travel: 0, accent: 0, duration: .75, ease: 'power3.inOut' }, .20);
    }

    return {
      frame,
      subscribe(listener) { listeners.add(listener); listener(); return () => listeners.delete(listener); },
      stop,
      step(direction) { if (!locked()) snap(Math.round(goal) + direction, .56); },
      choose(index) { if (!locked()) snap(nearestOffset(frame.offset, index), .62); },
      drag(distance) {
        if (locked()) return false;
        stop();
        changePhase(phases.rotating);
        frame.offset += distance;
        goal = frame.offset;
        publish();
        return true;
      },
      release(velocity) { if (!locked()) snap(Math.round(frame.offset + Math.max(-1.5, Math.min(1.5, velocity))), .57); },
      enter(index) { if (!locked()) enter(destinations[index], true); },
      back() { if (currentPhase === phases.page) leave(true); },
      reconcile(next) {
        if (next === currentPage && [phases.idle, phases.selected, phases.rotating, phases.page].includes(currentPhase)) return;
        if (!next) leave(false);
        else if (currentPage && currentPage !== next) {
          stop();
          changePage(null);
          Object.assign(frame, { travel: 0, cover: 0, accent: 0 });
          enter(next, false);
        } else enter(next, false);
      },
    };
  }, []);

  useEffect(() => { machine.reconcile(route); }, [machine, route]);
  useEffect(() => () => machine.stop(), [machine]);
  return { machine, page, selected, phase };
}
