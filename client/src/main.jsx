import React, { createContext, lazy, Suspense, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, ArrowRight, CircleAlert, Eye, EyeOff } from 'lucide-react';
import '@fontsource-variable/manrope';
import '@fontsource-variable/space-grotesk';
import '@fontsource/instrument-serif/400-italic.css';
import './style.css';
import { Landing } from './landing';
import { Brand } from './brand';
import { CinemaPlate, cinemaEase, pointPlate, restPlate } from './cinema';
import { useDestinationFilm } from './destination-media';
import aperture from './media/access-aperture.svg';
import './cinema.css';

const Auth = createContext(null);
const loadDashboard = () => import('./dashboard').then(module => ({ default: module.Dashboard }));
const Dashboard = lazy(loadDashboard);

async function request(path, { body, csrf, signal } = {}) {
  const response = await fetch(path, {
    signal, credentials: 'same-origin',
    ...(body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || '' },
      body: JSON.stringify(body)
    })
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: response.status });
  return data;
}

function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [connectionError, setConnectionError] = useState('');
  const refresh = useCallback(async () => {
    try {
      setSession(await request('/api/auth/session'));
      setConnectionError('');
    } catch (error) {
      setConnectionError(error.message);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const api = useCallback(async (path, body, signal) => {
    try {
      return await request(path, { body, csrf: session?.csrf, signal });
    } catch (error) {
      if (error.status === 401 && session?.user) void refresh();
      throw error;
    }
  }, [session, refresh]);
  async function authenticate(kind, body) {
    const result = await request('/api/auth/' + kind, { body, csrf: session?.csrf });
    if (kind === 'login') setSession(result);
    return result;
  }
  const value = { session, connectionError, refresh, api, authenticate };
  return <Auth.Provider value={value}>{children}</Auth.Provider>;
}

function AuthScreen() {
  const { session, authenticate, api, connectionError, refresh } = useContext(Auth);
  const navigate = useNavigate();
  const location = useLocation();
  const signup = location.pathname === '/signup';
  const reduced = useReducedMotion();
  const film = useDestinationFilm('identity', !reduced, true);
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const providerError = new URLSearchParams(location.search).has('oauth');
  const signedIn = Boolean(session?.user);
  useEffect(() => { loadDashboard().catch(() => {}); }, []);
  useEffect(() => { setVisible(false); setError(''); }, [signup]);
  useEffect(() => {
    if (signedIn) navigate('/workspace', { replace: true });
  }, [signedIn, navigate]);
  async function submit(event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setError('');
    setPending(true);
    try {
      const result = await authenticate(signup ? 'signup' : 'login', { email: values.get('email'), password: values.get('password') });
      if (signup) navigate('/login', { replace: true, state: { registration: result.message, email: values.get('email') } });
    } catch (error) {
      setError(error.message);
    } finally {
      setPending(false);
    }
  }
  async function google() {
    setError('');
    setPending(true);
    try {
      const start = await api('/api/auth/google/start', {});
      window.location.assign(start.url);
    } catch (error) {
      setError(error.message);
      setPending(false);
    }
  }

  const feedback = error || connectionError || (providerError && 'Google sign-in could not be completed. Try again or sign in with email.');
  return <main className="access-cinema" id="main" data-mode={signup ? 'signup' : 'login'}
    onPointerMove={event => { if (!event.target.closest('.access-panel')) pointPlate(event); }} onPointerLeave={restPlate}>
    <div className="access-atmosphere" aria-hidden="true">
      <CinemaPlate id="identity" film={film} />
      <img className="access-aperture" src={aperture} alt="" />
      <div className="cinema-grain" />
    </div>
    <header className="cinema-mast">
      <Brand />
      <Link className="cinema-link" to="/"><ArrowLeft size={16} />Back to platform</Link>
    </header>
    <div className="access-layout">
      <div className="access-editorial" aria-hidden="true">
        <p className="cinema-kicker"><span />Local cloud security</p>
        <strong>Cloud<br /><em>Sentinel.</em></strong>
      </div>
      <section className="access-panel" aria-labelledby="access-heading">
        <nav className="access-modes" aria-label="Account access">
          <Link to="/login" aria-current={signup ? undefined : 'page'}>Sign in</Link>
          <Link to="/signup" aria-current={signup ? 'page' : undefined}>Create account</Link>
        </nav>
        <motion.div key={signup ? 'signup' : 'login'} initial={reduced ? false : { opacity: .58, y: 10 }}
          animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : .35, ease: cinemaEase }}>
          <h1 id="access-heading">{signup ? 'Create an account' : 'Welcome back'}</h1>
          <p className="auth-intro">{signup ? 'New accounts have read-only workspace access.' : 'Sign in to your cloud security workspace.'}</p>
          {!signup && location.state?.registration && <p role="status">{location.state.registration}</p>}
          {feedback && <p className="feedback error" role="alert"><CircleAlert size={17} />{feedback}</p>}
          {connectionError && !session && <button type="button" className="button secondary" onClick={refresh}>Reconnect</button>}
          <form onSubmit={submit} className="auth-form" aria-busy={pending}>
            <label>Email address<input name="email" type="email" autoComplete="email" defaultValue={signup ? '' : location.state?.email} maxLength={254} placeholder="you@example.com" required /></label>
            <label>Password
              <span className="password-field"><input name="password" type={visible ? 'text' : 'password'} minLength={signup ? 15 : undefined}
                maxLength={128} autoComplete={signup ? 'new-password' : 'current-password'} required
                aria-describedby={signup ? 'password-hint' : undefined} />
                <button className="icon-button" type="button" onClick={() => setVisible(!visible)}
                  aria-label={visible ? 'Hide password' : 'Show password'}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button>
              </span>
            </label>
            {signup && <p className="form-hint" id="password-hint">Use at least 15 characters.</p>}
            <button className="cinema-action full" type="submit" disabled={pending || !session || signedIn}>
              <span>{signedIn ? 'Opening workspace…' : pending ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}</span>
              <ArrowRight size={18} />
            </button>
          </form>
          {session?.googleEnabled && <><div className="divider">or</div><button className="button secondary full" type="button"
            onClick={google} disabled={pending || signedIn}>Continue with Google</button></>}
        </motion.div>
      </section>
    </div>
  </main>;
}

function WorkspaceGate({ status = 'Opening workspace…', retry }) {
  return <main className="loading-screen cinema-loading" id="main">
    <CinemaPlate id="overview" />
    <Brand />
    <p role="status">{status}</p>
    {retry && <button className="button secondary" onClick={retry}>Retry</button>}
  </main>;
}

function Protected() {
  const { session, api, authenticate, connectionError, refresh } = useContext(Auth);
  const navigate = useNavigate();
  const signingOut = useRef(false);
  if (!session) return <WorkspaceGate status={connectionError || undefined} retry={connectionError ? refresh : undefined} />;
  if (!session.user) return signingOut.current ? <WorkspaceGate status="Returning to the platform…" /> : <Navigate to="/login" replace />;
  async function logout() {
    if (signingOut.current) return;
    signingOut.current = true;
    try {
      await authenticate('logout', {});
      navigate('/', { replace: true });
    } catch (error) {
      signingOut.current = false;
      throw error;
    }
  }
  return <Suspense fallback={<WorkspaceGate />}>
    <Dashboard user={session.user} api={api} onLogout={logout} />
  </Suspense>;
}

function App() {
  const { session } = useContext(Auth);
  const location = useLocation();
  const reduced = useReducedMotion();
  const group = location.pathname.startsWith('/workspace') ? 'workspace'
    : ['/login', '/signup'].includes(location.pathname) ? 'access' : 'public';
  useEffect(() => {
    if (group !== 'workspace') window.scrollTo({ top: 0, behavior: 'instant' });
  }, [group]);
  return <><a className="skip-link" href="#main">Skip to content</a><AnimatePresence mode="wait" initial={false}>
    <motion.div className="route" key={group} initial={reduced ? false : { opacity: .5 }}
      animate={{ opacity: 1 }} exit={{ opacity: reduced ? 1 : .52 }}
      transition={{ duration: reduced ? 0 : .29, ease: cinemaEase }}>
      <Routes location={location}>
        <Route index element={<Landing workspacePath={session?.user ? '/workspace' : '/login'} />} />
        <Route path="/login" element={<AuthScreen />} />
        <Route path="/signup" element={<AuthScreen />} />
        <Route path="/workspace/*" element={<Protected />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {!reduced && <motion.div className="cinema-splice" aria-hidden="true" initial={{ opacity: .56, x: '-105%' }}
        animate={{ opacity: 0, x: '105%' }} transition={{ duration: .55, ease: cinemaEase }} />}
    </motion.div>
  </AnimatePresence></>;
}

createRoot(document.getElementById('root')).render(
  <MotionConfig reducedMotion="user"><BrowserRouter><AuthProvider><App /></AuthProvider></BrowserRouter></MotionConfig>
);
