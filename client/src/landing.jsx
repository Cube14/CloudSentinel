import React, { useId } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Activity, Boxes, Fingerprint, Radar, ShieldCheck } from 'lucide-react';
import { Brand } from './brand';

const space = 'https://www.w3.org/2000/svg';
const vertex = ([x, y, z]) => [395 + (x - y) * 1.08, 330 + (x + y) * 0.44 - z * 0.96];
const polygon = points => points.map(p => vertex(p).join(',')).join(' ');
const axis = [-146, -109.5, -73, -36.5, 0, 36.5, 73, 109.5, 146];
const stars = Array.from({ length: 112 }, (_, i) => ({
  x: (i * 167 + 31) % 782, y: (i * i * 39 + i * 101 + 61) % 655,
  r: i % 17 === 0 ? 1.8 : 0.75, opacity: 0.15 + (i % 9) * 0.06
}));

export function CloudField({ compact = false }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const ref = name => 'url(#' + id + name + ')';
  const line = (a, b, key) => {
    const [x1, y1] = vertex(a);
    const [x2, y2] = vertex(b);
    return <line key={key} x1={x1} x2={x2} y1={y1} y2={y2} />;
  };
  const layers = [0, 43, 87, 135, 178];
  return <svg className={'cloud-field' + (compact ? ' compact-field' : '')} viewBox="0 0 790 665" xmlns={space} fill="none" aria-hidden="true">
    <defs>
      <radialGradient id={id + 'atmo'}><stop offset="0%" stopColor="#b82825" stopOpacity=".32" /><stop offset="60%" stopColor="#561a20" stopOpacity=".16" /><stop offset="100%" stopColor="#160f12" stopOpacity="0" /></radialGradient>
      <linearGradient id={id + 'top'} x2="1" y2="1"><stop stopColor="#35191d" /><stop offset="1" stopColor="#20181e" stopOpacity=".48" /></linearGradient>
      <linearGradient id={id + 'side'} x2="0" y2="1"><stop stopColor="#251719" stopOpacity=".45" /><stop offset="1" stopColor="#110f14" stopOpacity=".08" /></linearGradient>
      <linearGradient id={id + 'hot'} x2="1" y2="1"><stop stopColor="#fb655b" /><stop offset=".58" stopColor="#a52c36" /><stop offset="1" stopColor="#4a2229" /></linearGradient>
      <filter id={id + 'glow'} x="-180%" y="-180%" width="460%" height="460%"><feGaussianBlur stdDeviation="6" /></filter>
    </defs>
    <ellipse cx="411" cy="337" rx="394" ry="329" fill={ref('atmo')} />
    {stars.map((star, i) => <circle key={i} cx={star.x} cy={star.y} r={star.r} fill={i % 10 === 0 ? '#e85d66' : '#dbc8cb'} opacity={star.opacity} />)}
    <g className="field-orbit">
      {[210, 268, 330].map((radius, index) => <ellipse key={radius} cx="395" cy="368" rx={radius} ry={radius * .35} transform="rotate(-13 395 368)" stroke={index === 1 ? '#9a4b50' : '#595054'} strokeOpacity=".43" strokeDasharray={index === 1 ? '4 8' : '2 9'} />)}
      <path d="M95 406c107 34 358 4 527-79m-424 186c112 26 376-11 472-117M76 218l101 50m452-66 56-30M626 454l77 46M108 454l-50 34" stroke="#86444a" strokeOpacity=".32" />
    </g>
    <g className="cloud-cube">
      <ellipse cx="395" cy="507" rx="165" ry="36" fill="#b32f29" opacity=".26" filter={ref('glow')} />
      <polygon points={polygon([[-146, 146, 0], [146, 146, 0], [146, 146, 178], [-146, 146, 178]])} fill={ref('side')} />
      <polygon points={polygon([[146, -146, 0], [146, 146, 0], [146, 146, 178], [146, -146, 178]])} fill={ref('side')} />
      <polygon points={polygon([[-146, -146, 178], [146, -146, 178], [146, 146, 178], [-146, 146, 178]])} fill={ref('top')} />
      {layers.map((z, i) => <g key={z} stroke={i === 0 || i === 4 ? ref('hot') : '#742c35'} opacity={i === 0 || i === 4 ? .9 : .56}>
        <polygon points={polygon([[-146, -146, z], [146, -146, z], [146, 146, z], [-146, 146, z]])} />
        {axis.map((x, j) => <g key={x} opacity={i === 4 ? .65 : .28}>
          {line([x, -146, z], [x, 146, z], 'a' + j)}{line([-146, x, z], [146, x, z], 'b' + j)}
        </g>)}
      </g>)}
      <g stroke="#a14a51" opacity=".55">{axis.map(x => <g key={x}>
        {line([x, 146, 0], [x, 146, 178], 'l')}{line([146, x, 0], [146, x, 178], 'r')}
      </g>)}</g>
      <g stroke="#f35e54" strokeWidth="2.3" opacity=".87">
        {line([-146, 146, 0], [-146, 146, 178], 'a')}
        {line([146, 146, 0], [146, 146, 178], 'b')}
        {line([146, -146, 0], [146, -146, 178], 'c')}
      </g>
      <g stroke="#ef554b">
        <polygon points={polygon([[-146, -146, 178], [146, -146, 178], [146, 146, 178], [-146, 146, 178]])} opacity=".64" />
        <polygon points={polygon([[-146, -146, 178], [146, -146, 178], [146, 146, 178], [-146, 146, 178]])} strokeWidth="6" opacity=".48" filter={ref('glow')} />
      </g>
      {[[0,0,178],[-146,-146,178],[146,146,178],[146,-146,178],[-146,146,178],[146,146,0],[-146,146,0],[146,-146,0],[-73,36.5,178],[36.5,-73,178]].map((point, i) => {
        const [x, y] = vertex(point);
        const color = i === 8 || i === 9 ? '#7ee6e1' : '#ff7767';
        return <g key={i}><circle cx={x} cy={y} r={i === 0 ? 21 : 9} fill={color} opacity={i === 0 ? '.48' : '.52'} filter={ref('glow')} />
          <circle className="field-node" cx={x} cy={y} r={i === 0 ? 5.8 : 2.8} fill={color} /></g>;
      })}
      <g stroke="#ea5f59" strokeOpacity=".7" strokeDasharray="4 7"><path d="M395 157V72m0 360v103M88 287H35m665 0h57" /></g>
      <g fill="#fa7767"><circle cx="395" cy="72" r="4" /><circle cx="395" cy="535" r="3" /><circle cx="35" cy="287" r="3" /><circle cx="757" cy="287" r="3" /></g>
    </g>
    <g stroke="#b48187" strokeOpacity=".46"><path d="M54 131h23m-11-11v23m632 61h23m-11-11v23M597 530h23m-11-11v23M153 553h23m-11-11v23" /></g>
  </svg>;
}

const reveal = { initial: { opacity: 0, y: 24 }, whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.13 }, transition: { duration: .56 } };

export function Landing() {
  return <div className="landing">
    <header className="landing-nav">
      <div className="landing-shell nav-inner">
        <Brand />
        <nav aria-label="Main navigation"><a href="#platform">Platform</a><a href="#sources">Environments</a></nav>
        <div className="nav-actions"><Link className="sign-in-link" to="/login">Sign in</Link><Link className="button secondary nav-cta" to="/signup">Create account</Link></div>
      </div>
    </header>
    <main id="main">
      <section className="hero">
        <div className="hero-art"><CloudField /></div>
        <div className="landing-shell hero-inner">
          <motion.div className="hero-copy" initial={{ opacity: 0, y: 26 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .72 }}>
            <p className="eyebrow"><span className="signal-line" /> CLOUD SECURITY OBSERVATORY</p>
            <h1>See the risk.<br /><em>Own the cloud.</em></h1>
            <p>Monitor cloud posture, trace findings to their evidence, and investigate incidents from one local workspace.</p>
            <div className="hero-actions"><Link className="button primary" to="/login">Open workspace</Link><a className="button secondary" href="#platform">Explore the platform</a></div>
          </motion.div>
          <div className="hero-caption"><span className="crosshair">+</span> CLOUD INVENTORY · SIGNAL CORRELATION</div>
        </div>
      </section>

      <div className="source-rail" id="sources">
        <div className="landing-shell rail-inner"><span>SUPPORTED ENVIRONMENTS</span><div>
          <span>AWS <small>Fixture</small></span><span>Azure <small>Fixture</small></span><span>Google Cloud <small>Fixture</small></span><span>Floci <small>Local emulator</small></span>
        </div></div>
      </div>

      <section className="landing-shell platform" id="platform">
        <motion.div className="section-intro" {...reveal}>
          <p className="eyebrow"><span className="signal-line" /> MONITORING & INVESTIGATION</p>
          <h2>From posture to <em>proof.</em></h2>
          <p>See what changed, which environment produced it, and the evidence behind each finding.</p>
        </motion.div>
        <div className="feature-grid">
          {[
            [Boxes, 'Inventory by environment', 'Switch between simulated cloud fixtures and the read-only Floci emulator. Every finding carries its source.'],
            [Activity, 'Scan history', 'Watch queued, completed, and failed scans. Follow findings as they reopen or resolve after configuration changes.'],
            [Fingerprint, 'Incident investigation', 'Review recorded events and attack stages. Local Ollama can suggest what to verify against the evidence.']
          ].map(([Icon, title, text], index) => <motion.article key={title} className="feature-card" {...reveal} transition={{ duration: .5, delay: index * .07 }}>
            <span className="feature-icon"><Icon size={24} strokeWidth={1.5} /></span><h3>{title}</h3><p>{text}</p>
          </motion.article>)}
        </div>
      </section>
      <section className="control-section">
        <div className="landing-shell control-inner">
          <motion.div {...reveal}><p className="eyebrow"><Radar size={16} /> WORKSPACE SECURITY</p><h2>Visibility with <em>control.</em></h2>
            <p>Start with a viewer account. Admins can run scans, investigate incidents, and approve simulated responses under their signed-in identity.</p><Link className="button primary" to="/signup">Create account</Link></motion.div>
          <div className="control-visual" aria-hidden="true"><div /><div /><div /><ShieldCheck size={78} strokeWidth={.9} /></div>
        </div>
      </section>
    </main>
    <footer className="landing-shell landing-footer"><Brand /><span>Local cloud security monitoring</span><Link to="/login">Sign in</Link></footer>
  </div>;
}
