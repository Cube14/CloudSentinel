import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { Activity, Boxes, Fingerprint, FolderSearch, GitBranch, ScanLine, ShieldCheck } from 'lucide-react';
import { Brand } from './brand';
import { NetworkVisual } from './network-visual';

const chapters = [
  { verb: 'Detect', title: 'See the posture of every source.', icon: ScanLine,
    copy: 'Run deterministic checks on AWS, Azure, and Google Cloud fixtures or a live, read-only Floci emulator. Inspect every result with its source and evidence.',
    input: 'Fixture inventory / Floci', processor: 'Deterministic rules', output: 'Posture findings' },
  { verb: 'Correlate', title: 'Follow the evidence through the chain.', icon: GitBranch,
    copy: 'Tie related fixture events to recorded attack stages. Review actors, resources, and timestamps in the order they were observed.',
    input: 'Recorded fixture events', processor: 'Incident correlation', output: 'Attack stages and evidence' },
  { verb: 'Investigate', title: 'Ask what to verify next.', icon: FolderSearch,
    copy: 'Start with recorded observations. Local Ollama can suggest hypotheses and verification steps, with a deterministic fallback when the model is unavailable.',
    input: 'Incident evidence', processor: 'Local Ollama / rule fallback', output: 'Verification steps' }
];

function StoryPreview({ index, change, progress }) {
  const reduced = useReducedMotion();
  const tilt = useTransform(progress, [0, 1], [-3, 2]);
  const drift = useTransform(progress, [0, 1], [13, -10]);
  const stage = chapters[index];
  const Icon = stage.icon;

  return <div className="preview-rail">
    <motion.div className="platform-preview" style={reduced ? {} : { rotateX: tilt, y: drift }}>
      <div className="preview-head"><span><Activity size={17} /> Platform walkthrough</span><span>Architecture view</span></div>
      <div className="preview-tabs" aria-label="Walkthrough chapters">
        {chapters.map(({ verb }, chapter) => <button key={verb} type="button" onClick={() => change(chapter)}
          aria-pressed={chapter === index}>{verb}</button>)}
      </div>
      <div className="preview-content" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={stage.verb} className="architecture-preview" initial={{ opacity: .32, y: reduced ? 0 : 9 }}
            animate={{ opacity: 1, y: 0 }} exit={{ opacity: .32 }} transition={{ duration: reduced ? 0 : .24 }}>
            <div className="architecture-node"><Boxes size={20} /><div><small>INPUT</small><strong>{stage.input}</strong></div></div>
            <motion.div className="architecture-link" initial={{ opacity: .35 }} animate={{ opacity: 1 }} transition={{ duration: .6 }} />
            <div className="architecture-node processor-node"><Icon size={23} /><div><small>PROCESS</small><strong>{stage.processor}</strong></div></div>
            <motion.div className="architecture-link" initial={{ opacity: .35 }} animate={{ opacity: 1 }} transition={{ duration: .6, delay: .1 }} />
            <div className="architecture-node"><ShieldCheck size={20} /><div><small>OUTPUT</small><strong>{stage.output}</strong></div></div>
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  </div>;
}

function Story() {
  const story = useRef(null);
  const [index, setIndex] = useState(0);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: story, offset: ['start start', 'end end'] });
  useMotionValueEvent(scrollYProgress, 'change', value => {
    if (matchMedia('(min-width: 851px)').matches) setIndex(Math.min(chapters.length - 1, Math.floor(value * chapters.length)));
  });
  function change(next) {
    setIndex(next);
    if (matchMedia('(min-width: 851px)').matches) {
      const top = story.current.getBoundingClientRect().top + window.scrollY;
      const length = Math.max(0, story.current.offsetHeight - window.innerHeight);
      window.scrollTo({ top: top + length * ((next + .57) / chapters.length), behavior: reduced ? 'instant' : 'smooth' });
    }
  }
  return <section className="story-section" id="platform" aria-labelledby="platform-heading">
    <div className="landing-shell story-intro">
      <p className="eyebrow"><span className="signal-line" /> THE PLATFORM</p>
      <h2 id="platform-heading">From signal to <em>evidence.</em></h2>
      <p>Each stage preserves the context that makes a finding useful.</p>
    </div>
    <div className="landing-shell story-grid" ref={story}>
      <div className="story-chapters">{chapters.map(({ verb, title, copy, icon: Icon }, chapter) =>
        <article key={verb} className={index === chapter ? 'story-active' : ''}>
          <div><p className="eyebrow"><Icon size={17} /> {verb}</p><h3>{title}</h3><p>{copy}</p></div>
        </article>)}</div>
      <StoryPreview index={index} change={change} progress={scrollYProgress} />
    </div>
  </section>;
}

export function Landing() {
  const reduced = useReducedMotion();
  const hero = useRef(null);
  const { scrollYProgress } = useScroll({ target: hero, offset: ['start start', 'end start'] });
  const parallax = useTransform(scrollYProgress, [0, 1], [0, 94]);
  const zoom = useTransform(scrollYProgress, [0, 1], [1, .94]);
  return <div className="landing">
    <header className="landing-nav"><div className="landing-shell nav-inner">
      <Brand />
      <nav aria-label="Main navigation"><a href="#platform">Platform</a><a href="#sources">Environments</a></nav>
      <div className="nav-actions"><Link className="sign-in-link" to="/login">Sign in</Link><Link className="button secondary nav-cta" to="/signup">Create account</Link></div>
    </div></header>
    <main id="main">
      <section className="hero" ref={hero}>
        <div className="landing-shell hero-inner">
          <motion.div className="hero-copy" initial={{ opacity: .55, y: reduced ? 0 : 18 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduced ? 0 : .55 }}>
            <p className="eyebrow"><span className="signal-line" /> CLOUD SECURITY OBSERVATORY</p>
            <h1><motion.span initial={{ y: reduced ? 0 : 13 }} animate={{ y: 0 }} transition={{ duration: .5 }}>Clarity across</motion.span>
              <motion.em initial={{ opacity: .55, y: reduced ? 0 : 20 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduced ? 0 : .56, delay: reduced ? 0 : .08 }}>your cloud.</motion.em></h1>
            <p>Track cloud posture, follow the evidence, and investigate incidents from one local security workspace.</p>
            <div className="hero-actions"><Link className="button primary" to="/login">Open workspace</Link>
              <a className="button text-button" href="#platform">Explore the platform</a></div>
          </motion.div>
          <motion.div className="hero-art" style={reduced ? {} : { y: parallax, scale: zoom }}>
            <NetworkVisual camera={scrollYProgress} />
          </motion.div>
        </div>
        <div className="hero-base" aria-hidden="true"><div /><div /></div>
      </section>
      <section className="source-rail" id="sources" aria-labelledby="source-label"><div className="landing-shell rail-inner">
        <h2 id="source-label">Supported environments</h2>
        {[['AWS', 'Fixture'], ['Azure', 'Fixture'], ['Google Cloud', 'Fixture'], ['Floci', 'Local emulator']].map(([name, label]) =>
          <div key={name}><strong>{name}</strong><small>{label}</small></div>)}
      </div></section>
      <Story />
      <section className="control-section"><div className="landing-shell control-inner">
        <div><p className="eyebrow"><Fingerprint size={17} /> WORKSPACE ACCESS</p>
          <h2>Visibility with <em>control.</em></h2>
          <p>Viewers can inspect results. Administrators can run scans, investigate incidents, and record simulated responses under their signed-in identity.</p>
          <Link className="button primary" to="/signup">Create account</Link></div>
        <div className="control-signature" aria-hidden="true"><ShieldCheck size={99} strokeWidth={.7} /></div>
      </div></section>
    </main>
    <footer className="landing-shell landing-footer"><Brand /><span>Local cloud security monitoring</span><Link to="/login">Sign in</Link></footer>
  </div>;
}
