import React, { lazy, Suspense, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { ArrowDown, ArrowDownRight, ArrowRight } from 'lucide-react';
import { Brand } from './brand';
import { CinemaPlate, cinemaEase, pointPlate, restPlate } from './cinema';
import { useDestinationFilm, useMediaVisible } from './destination-media';

const CarouselPreview = lazy(() => import('./carousel-preview'));
const chapters = [
  { verb: 'Detect', id: 'environments', title: 'Know what’s exposed.',
    copy: 'Monitor AWS with read-only credentials, explore AWS, Azure and Google Cloud fixtures, or scan the local Floci emulator. Findings carry their source and coverage.' },
  { verb: 'Correlate', id: 'findings', title: 'Follow the evidence.',
    copy: 'Trace recorded events through an incident. Review each actor, resource and timestamp alongside the original evidence.' },
  { verb: 'Investigate', id: 'analyst', title: 'Decide what to verify.',
    copy: 'Ask the local Ollama analyst for hypotheses and verification steps based on recorded evidence. Deterministic analysis is available when the model is offline.' },
];

function Story({ active, stage, index, change, onScroll, reduced, film }) {
  const { scrollYProgress } = useScroll({ target: stage, offset: ['start start', 'end end'] });
  const travel = useTransform(scrollYProgress, [0, .33, .66, 1], ['0%', '-2.7%', '1.8%', '-2.4%']);
  const zoom = useTransform(scrollYProgress, [0, 1], [1.035, 1.14]);
  useMotionValueEvent(scrollYProgress, 'change', value => {
    if (!reduced && active) onScroll(Math.min(chapters.length - 1, Math.floor(value * chapters.length)));
  });
  const chapter = chapters[index];
  return <section className="cinema-story" id="platform" ref={stage} aria-label="How CloudSentinel works">
    <div className="cinema-story-screen">
      <div className="cinema-story-art" aria-hidden="true">
        <div className="story-flank" />
        <AnimatePresence initial={false}>
          <motion.div className="story-shot" key={chapter.id}
            initial={reduced ? false : { opacity: 0, clipPath: 'inset(4% 0 0 0)' }}
            animate={{ opacity: 1, clipPath: 'inset(0% 0 0 0)' }} exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : .56, ease: cinemaEase }}>
            <CinemaPlate id={chapter.id} film={film} style={reduced ? {} : { x: travel, scale: zoom }} />
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="cinema-story-inner">
        <p className="cinema-kicker"><span />From posture to evidence</p>
        <div className="cinema-story-copy" aria-live="off">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={chapter.verb} initial={reduced ? false : { y: 22, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }} exit={reduced ? {} : { y: -9, opacity: 0 }}
              transition={{ duration: reduced ? 0 : .24, ease: cinemaEase }}>
              <h2>{chapter.verb}<em>.</em></h2>
              <h3>{chapter.title}</h3>
              <p>{chapter.copy}</p>
            </motion.div>
          </AnimatePresence>
        </div>
        <nav className="cinema-chapters" aria-label="Platform chapters">
          {chapters.map(({ verb }, step) => <button key={verb} type="button" onClick={() => change(step)}
            aria-current={index === step ? 'step' : undefined}>{verb}</button>)}
        </nav>
      </div>
    </div>
  </section>;
}

export function Landing({ workspacePath = '/login' }) {
  const reduced = useReducedMotion();
  const hero = useRef(null);
  const stage = useRef(null);
  const heroVisible = useMediaVisible(hero);
  const storyVisible = useMediaVisible(stage);
  const [index, setIndex] = useState(0);
  const [preview, setPreview] = useState(false);
  const target = heroVisible ? 'overview' : chapters[index].id;
  const film = useDestinationFilm(target, !reduced, heroVisible || storyVisible);
  const { scrollYProgress } = useScroll({ target: hero, offset: ['start start', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], ['0%', '17%']);
  const scale = useTransform(scrollYProgress, [0, 1], [1, 1.11]);
  function change(next) {
    setIndex(next);
    if (reduced) return;
    const rect = stage.current.getBoundingClientRect();
    const length = Math.max(0, rect.height - window.innerHeight);
    window.scrollTo({ top: rect.top + window.scrollY + length * ((next + .35) / chapters.length), behavior: 'instant' });
  }
  return <div className="cinema-public">
    <header className="cinema-mast">
      <Brand />
      <nav aria-label="Main navigation"><a href="#platform">Platform</a><a href="#preview">Preview</a></nav>
      <Link className="cinema-link" to={workspacePath}>{workspacePath === '/login' ? 'Sign in' : 'Workspace'}<ArrowDownRight size={16} /></Link>
    </header>
    <main id="main">
      <section className="cinema-hero" ref={hero} onPointerMove={pointPlate} onPointerLeave={restPlate}>
        <CinemaPlate id="overview" film={heroVisible ? film : null} style={reduced ? {} : { y, scale }} />
        <div className="cinema-hero-shade" aria-hidden="true" />
        <div className="cinema-grain" aria-hidden="true" />
        <div className="cinema-hero-inner">
          <p className="cinema-kicker"><span />Local cloud security</p>
          <h1><span>Cloud</span><span>Sentinel</span></h1>
          <div className="cinema-hero-foot">
            <p>See what’s exposed across your cloud.<br />Follow the evidence from posture to incident.</p>
            <Link className="cinema-action cinema-magnetic" to={workspacePath} onPointerMove={pointPlate} onPointerLeave={restPlate}>
              Enter platform<ArrowDownRight size={18} />
            </Link>
          </div>
        </div>
        <a className="cinema-scroll" href="#platform">Explore the platform <ArrowDown size={16} /></a>
      </section>
      <Story active={storyVisible} stage={stage} index={index} change={change} onScroll={setIndex} reduced={reduced}
        film={heroVisible ? null : film} />
      <section className="cinema-preview" id="preview" aria-labelledby="preview-heading">
        <div className="cinema-preview-heading">
          <div><p className="cinema-kicker"><span />Interactive preview</p><h2 id="preview-heading">Inside the <em>workspace.</em></h2></div>
          <p>Explore the destination carousel. Sign in to see your own sources, findings and audit history.</p>
        </div>
        {preview ? <Suspense fallback={<div className="cinema-preview-loading" role="status">Opening the carousel preview…</div>}>
          <CarouselPreview workspacePath={workspacePath} />
        </Suspense> : <div className="cinema-preview-cover">
          <CinemaPlate id="assets" />
          <button className="cinema-action" type="button" onClick={() => setPreview(true)}>Explore destinations<ArrowRight size={18} /></button>
        </div>}
      </section>
    </main>
    <footer className="cinema-footer">
      <Brand /><Link to={workspacePath}>Enter platform <ArrowDownRight size={16} /></Link>
      <Link to="/signup">Create account <ArrowRight size={16} /></Link>
    </footer>
  </div>;
}
