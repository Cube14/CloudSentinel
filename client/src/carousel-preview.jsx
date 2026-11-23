import React, { Component, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useReducedMotion } from 'motion/react';
import { ArrowDownRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { useCarouselDirector } from './carousel-director';
import { destinations } from './carousel-state';
import { destinationMedia, useMediaVisible, useVideoPermission } from './destination-media';

const CarouselScene = lazy(() => import('./carousel-scene'));
const ignoreRoute = () => {};
const capabilities = {
  overview: 'Review posture, scan history and the severity of open findings.',
  environments: 'Check which inventories are live, emulated or fixture-backed, with coverage and scan status.',
  findings: 'Filter open and resolved findings and inspect the evidence behind each rule.',
  assets: 'Search the discovered inventory or open a topology based on collected resource links.',
  identity: 'Review discovered identity assets and their recorded access findings.',
  threats: 'Follow incident stages alongside their recorded events.',
  analyst: 'Investigate recorded evidence with local Ollama or deterministic analysis.',
  audit: 'Review recorded workspace actions and their timestamps.',
};

class PreviewBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onLoss(); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export default function CarouselPreview({ workspacePath }) {
  const shell = useRef(null);
  const parallax = useRef({ x: 0, y: 0, invalidate: null });
  const visible = useMediaVisible(shell);
  const permitted = useVideoPermission();
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState(() => !('WebGL2RenderingContext' in window));
  const immersive = permitted && !reduced && !failed;
  const { machine, selected } = useCarouselDirector(null, ignoreRoute, immersive);
  const onLoss = useCallback(() => setFailed(true), []);
  useEffect(() => { shell.current?.focus({ preventScroll: true }); }, []);
  const item = destinations[selected];
  const destinationPath = workspacePath === '/workspace' ? workspacePath + '/' + item.id : workspacePath;
  const fallback = <img className="preview-still" src={destinationMedia(item.id).poster} alt="" />;
  return <div className="preview-carousel" ref={shell} tabIndex={-1} aria-label="Workspace carousel preview"
    onKeyDown={event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      machine.step(event.key === 'ArrowLeft' ? -1 : 1);
    }}>
    <div className="preview-screen">
      {immersive ? <PreviewBoundary onLoss={onLoss} fallback={fallback}>
        <Suspense fallback={fallback}>
          <CarouselScene {...{ machine, selected, visible, parallax, onLoss }} interactive effects={false} onSelect={machine.choose} />
        </Suspense>
      </PreviewBoundary> : fallback}
      <div className="preview-caption" aria-live="polite"><strong>{item.title}</strong><span>{item.subtitle}</span></div>
    </div>
    <div className="preview-controls">
      <button type="button" aria-label="Previous preview destination" onClick={() => machine.step(-1)}><ChevronLeft size={20} /></button>
      <button type="button" aria-label="Next preview destination" onClick={() => machine.step(1)}><ChevronRight size={20} /></button>
      <nav aria-label="Preview destinations">
        {destinations.map((destination, index) => <button key={destination.id} type="button" onClick={() => machine.choose(index)}
          aria-current={selected === index ? 'true' : undefined}>{destination.title}</button>)}
      </nav>
      <Link className="cinema-link" to={destinationPath}>{workspacePath === '/workspace' ? 'Open ' + item.title : 'Enter platform'}<ArrowDownRight size={16} /></Link>
    </div>
    <p className="preview-capability" aria-live="polite">{capabilities[item.id]}</p>
  </div>;
}
