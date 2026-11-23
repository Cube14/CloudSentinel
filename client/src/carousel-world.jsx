import React, { Component, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDownRight, ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, LogOut } from 'lucide-react';
import { Brand } from './brand';
import { destinations, phases } from './carousel-state';
import { destinationMedia, useMediaVisible } from './destination-media';
import { framing } from './media-framing';
import './carousel-world.css';

const Scene = lazy(() => import('./carousel-scene'));
const focalPosition = id => framing[id].map(value => value * 100 + '%').join(' ');
const canRotate = phase => [phases.idle, phases.rotating, phases.selected].includes(phase);

class RendererBoundary extends Component {
  state = { failure: false };
  static getDerivedStateFromError() { return { failure: true }; }
  componentDidCatch() { this.props.onLoss(); }
  render() { return this.state.failure ? null : this.props.children; }
}

function PosterRing({ selected, choose }) {
  const neighbors = [selected - 1, selected, selected + 1];
  return <div className="carousel-2d">{neighbors.map((index, step) => {
    const item = destinations[(index + destinations.length) % destinations.length];
    return <button type="button" tabIndex={-1} onClick={() => choose(destinations.indexOf(item))}
      className={step === 1 ? 'poster-front' : ''} key={item.id} aria-label={'Select ' + item.title}>
      <img alt="" draggable="false" src={destinationMedia(item.id).poster} style={{ '--film-focus': focalPosition(item.id) }} />
    </button>;
  })}</div>;
}

export function CarouselWorld({ machine, selected, phase, cinematic, toggleEffects, reduced, logout, film, onMediaVisibility }) {
  const shell = useRef(null);
  const enter = useRef(null);
  const pointer = useRef(null);
  const parallax = useRef({ x: 0, y: 0, invalidate: null });
  const visible = useMediaVisible(shell);
  const [failed, setFailed] = useState(() => !('WebGL2RenderingContext' in window));
  const [activated, setActivated] = useState(false);
  const interactive = canRotate(phase);
  const shown = phase !== phases.page;
  const destination = destinations[selected];
  const onLoss = useCallback(() => setFailed(true), []);
  useEffect(() => { if (shown && cinematic) setActivated(true); }, [shown, cinematic]);
  useEffect(() => machine.subscribe(() => {
    const { travel, accent } = machine.frame;
    shell.current?.style.setProperty('--travel', travel.toFixed(4));
    shell.current?.style.setProperty('--impact', accent.toFixed(4));
  }), [machine]);

  useEffect(() => {
    const stage = shell.current?.querySelector('.carousel-gesture');
    if (!stage || !interactive) return;
    let timer;
    function wheel(event) {
      if (event.ctrlKey) return;
      event.preventDefault();
      const axis = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const units = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? 425 : 1;
      const step = Math.max(-.85, Math.min(.85, axis * units / 510));
      if (cinematic) machine.drag(step);
      else if (!timer) machine.step(Math.sign(step));
      clearTimeout(timer);
      timer = setTimeout(() => { if (cinematic) machine.release(step * .50); timer = undefined; }, 105);
    }
    stage.addEventListener('wheel', wheel, { passive: false });
    return () => { stage.removeEventListener('wheel', wheel); clearTimeout(timer); };
  }, [machine, interactive, cinematic]);

  useEffect(() => {
    if (phase === phases.idle) enter.current?.focus({ preventScroll: true });
  }, [phase]);

  function dragStart(event) {
    if (!interactive || !event.isPrimary || event.button !== 0 || event.target.closest('button')) return;
    pointer.current = { id: event.pointerId, origin: event.clientX, last: event.clientX, at: event.timeStamp, speed: 0, moved: false };
  }
  function dragMove(event) {
    const drag = pointer.current;
    if (cinematic && interactive && !drag && event.pointerType === 'mouse') {
      const bounds = event.currentTarget.getBoundingClientRect();
      parallax.current.x = (event.clientX - bounds.left) / bounds.width * 2 - 1;
      parallax.current.y = (event.clientY - bounds.top) / bounds.height * 2 - 1;
      parallax.current.invalidate?.();
    }
    if (!interactive || !drag || drag.id !== event.pointerId) return;
    if (!drag.moved && Math.abs(event.clientX - drag.origin) < 7) return;
    if (!drag.moved) event.currentTarget.setPointerCapture(event.pointerId);
    drag.moved = true;
    const delta = (drag.last - event.clientX) / 290;
    drag.speed = delta / Math.max(8, event.timeStamp - drag.at);
    drag.last = event.clientX;
    drag.at = event.timeStamp;
    machine.drag(delta);
  }
  function dragEnd(event) {
    const drag = pointer.current;
    if (!drag || drag.id !== event.pointerId) return;
    pointer.current = null;
    if (drag.moved) machine.release(event.type === 'pointercancel' || event.timeStamp - drag.at > 110 ? 0 : drag.speed * 120);
  }
  function onKeyDown(event) {
    if (!interactive) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      machine.step(event.key === 'ArrowRight' ? 1 : -1);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      machine.choose(event.key === 'Home' ? 0 : destinations.length - 1);
    } else if (event.key === 'Enter' && event.target === event.currentTarget) {
      event.preventDefault();
      machine.enter(selected);
    }
  }
  function selectScreen(index) {
    if (index === selected) machine.enter(index);
    else machine.choose(index);
  }

  const renderWebGL = activated && !failed && cinematic;
  useEffect(() => {
    onMediaVisibility(renderWebGL && visible && shown);
  }, [onMediaVisibility, renderWebGL, visible, shown]);
  const fallback = <PosterRing selected={selected} choose={selectScreen} />;
  return <section className="carousel-world" ref={shell} data-phase={phase} data-destination={destination.id}
    hidden={!shown} inert={!interactive} aria-label="Destination carousel" aria-roledescription="carousel"
    tabIndex={interactive ? 0 : undefined} onKeyDown={onKeyDown}>
    <div className="carousel-gesture" onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={dragEnd} onPointerLeave={() => {
      parallax.current.x = 0; parallax.current.y = 0;
      parallax.current.invalidate?.();
    }}>
      {renderWebGL ? <RendererBoundary onLoss={onLoss}>
        <Suspense fallback={fallback}>
          <Scene machine={machine} selected={selected} visible={visible && shown} interactive={interactive}
            effects={cinematic} film={film} parallax={parallax} onSelect={selectScreen} onLoss={onLoss} />
        </Suspense>
      </RendererBoundary> : fallback}
    </div>
    <div className="carousel-optics" aria-hidden="true" />
    <header className="carousel-mast">
      <Brand />
      <div className="carousel-tools">
        <button className="effects-toggle" type="button" disabled={!!reduced} aria-pressed={cinematic} onClick={toggleEffects}>Effects {cinematic ? 'on' : 'off'}</button>
        <button className="icon-button" type="button" aria-label="Sign out" onClick={logout}><LogOut size={19} /></button>
      </div>
    </header>
    <div className="carousel-editorial" key={destination.id}>
      <p>{destination.subtitle}</p>
      <h1>{destination.title}</h1>
    </div>
    <p className="sr-only" aria-live="polite" aria-atomic="true">{destination.title}, {selected + 1} of {destinations.length}</p>
    <div className="carousel-console">
      <div className="carousel-controls">
        <button type="button" className="icon-button carousel-arrow" aria-label="Previous destination" onClick={() => machine.step(-1)}><ChevronLeft size={20} /></button>
        <button type="button" className="carousel-enter" ref={enter} onClick={() => machine.enter(selected)}
          aria-label={'Enter ' + destination.title}>Enter {destination.title} <ArrowDownRight size={19} /></button>
        <button type="button" className="icon-button carousel-arrow" aria-label="Next destination" onClick={() => machine.step(1)}><ChevronRight size={20} /></button>
      </div>
      <nav className="carousel-index" aria-label="Destinations">
        {destinations.map((item, index) => <button key={item.id} type="button" aria-current={selected === index ? 'true' : undefined}
          aria-label={'Select ' + item.title} onClick={() => machine.choose(index)}><span>{item.title}</span></button>)}
      </nav>
      <p className="carousel-hint">{failed ? '2D navigation' : 'Scroll or drag to explore'} <span>{String(selected + 1).padStart(2, '0')} / 08</span></p>
    </div>
  </section>;
}

export function DestinationPage({ destination, phase, machine, cinematic, reduced, toggleEffects, scopeControls, metrics, film, onMediaVisibility, children }) {
  const section = useRef(null);
  const sky = useRef(null);
  const plate = useRef(null);
  const heading = useRef(null);
  const visible = useMediaVisible(sky);
  const media = destinationMedia(destination.id);
  const active = phase === phases.page;
  useEffect(() => machine.subscribe(() => {
    section.current?.style.setProperty('--portal-cover', machine.frame.cover.toFixed(4));
  }), [machine]);
  useEffect(() => {
    if (active) heading.current?.focus({ preventScroll: true });
  }, [active, destination]);
  useEffect(() => {
    onMediaVisibility(visible);
    return () => onMediaVisibility(false);
  }, [onMediaVisibility, visible]);

  useLayoutEffect(() => {
    if (film?.id !== destination.id) return;
    const element = film.element;
    plate.current.append(element);
    return () => element.remove();
  }, [film, destination.id]);

  function aim(event) {
    if (!cinematic || event.pointerType !== 'mouse') return;
    const bounds = sky.current.getBoundingClientRect();
    plate.current.style.setProperty('--film-x', ((event.clientX - bounds.left) / bounds.width - .5) * 17 + 'px');
    plate.current.style.setProperty('--film-y', ((event.clientY - bounds.top) / bounds.height - .5) * 11 + 'px');
  }
  return <section className={'destination-experience destination-' + destination.style} ref={section} data-phase={phase}
    style={{ '--destination-tone': destination.tone, '--portal-cover': machine.frame.cover,
      '--film-focus': focalPosition(destination.id) }}
    inert={!active} aria-label={destination.title}>
    <header className="destination-mast">
      <button className="destination-back" type="button" onClick={machine.back}><ArrowLeft size={19} /> <span>Back to carousel</span></button>
      <button className="effects-toggle" type="button" disabled={!!reduced} aria-pressed={cinematic}
        onClick={toggleEffects}>Effects {cinematic ? 'on' : 'off'}</button>
    </header>
    <div className="destination-hero" ref={sky} data-film-in-view={visible} onPointerMove={aim} onPointerLeave={() => {
      plate.current.style.removeProperty('--film-x'); plate.current.style.removeProperty('--film-y');
    }}>
      <div className="destination-plate" ref={plate} aria-hidden="true">
        <img className="destination-ambient" src={media.poster} alt="" />
        <img className="destination-film" src={media.poster} alt="" />
      </div>
      <div className="destination-film-grain" aria-hidden="true" />
      <div className="destination-shade" aria-hidden="true" />
      <div className="destination-title">
        <p>{destination.subtitle}</p>
        <h1 tabIndex={-1} ref={heading}>{destination.title}</h1>
        <a className="destination-content-link" href="#workspace-operations">Open operations <ArrowDownRight size={19} /></a>
      </div>
      {metrics && <div className="destination-metrics">{metrics}</div>}
    </div>
    <section className="destination-operations" id="workspace-operations" tabIndex={-1} aria-label={destination.title + ' operations'}>
      {scopeControls}
      {children}
    </section>
  </section>;
}
