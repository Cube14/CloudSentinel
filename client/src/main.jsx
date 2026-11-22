import React, { createContext, lazy, Suspense, useCallback, useContext, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { AudioLines, CircleAlert, Eye, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react';
import '@fontsource-variable/manrope';
import '@fontsource-variable/space-grotesk';
import '@fontsource/instrument-serif/400-italic.css';
import './style.css';
import { Landing } from './landing';
import { Brand } from './brand';
import { NetworkVisual } from './network-visual';

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
    setSession(await request('/api/auth/' + kind, { body, csrf: session?.csrf }));
  }
  const value = { session, connectionError, refresh, api, authenticate };
  return <Auth.Provider value={value}>{children}</Auth.Provider>;
}

function AuthScreen({ signup = false }) {
  const { session, authenticate, api, connectionError, refresh } = useContext(Auth);
  const navigate = useNavigate();
  const location = useLocation();
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const providerError = new URLSearchParams(location.search).has('oauth');
  const signedIn = Boolean(session?.user);
  useEffect(() => {
    const timer = setTimeout(() => { loadDashboard().catch(() => {}); }, 350);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (signedIn) navigate('/workspace', { replace: true });
  }, [signedIn, navigate]);
  async function submit(event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setError('');
    setPending(true);
    try {
      await authenticate(signup ? 'signup' : 'login', { email: values.get('email'), password: values.get('password') });
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

  return <main className="auth-page" id="main">
    <div className="auth-left">
      <div className="auth-top"><Brand /><Link to="/">Back to platform</Link></div>
      <div className="auth-content">
        <p className="eyebrow"><LockKeyhole size={15} /> WORKSPACE ACCESS</p>
        <h1>{signup ? 'Create an account' : 'Welcome back'}</h1>
        <p className="auth-intro">{signup ? 'New accounts have read-only workspace access.' : 'Sign in to view your cloud security workspace.'}</p>
        {(error || providerError || connectionError) && <p className="feedback error" role="alert"><CircleAlert size={17} />{error || connectionError || 'Google sign-in could not be completed. Try again or sign in with email.'}</p>}
        {connectionError && !session && <button className="button secondary" onClick={refresh}>Reconnect</button>}
        <form onSubmit={submit} className="auth-form">
          <label>Email address<input name="email" type="email" autoComplete="email" maxLength={254} placeholder="you@example.com" required /></label>
          <label>Password
            <span className="password-field"><input name="password" type={visible ? 'text' : 'password'} minLength={signup ? 15 : undefined} maxLength={128} autoComplete={signup ? 'new-password' : 'current-password'} required aria-describedby={signup ? 'password-hint' : undefined} />
              <button className="icon-button" type="button" onClick={() => setVisible(!visible)} aria-label={visible ? 'Hide password' : 'Show password'}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button>
            </span>
          </label>
          {signup && <p className="form-hint" id="password-hint">Use at least 15 characters.</p>}
          <button className="button primary full" type="submit" disabled={pending || !session || signedIn}>
            {signedIn ? 'Opening workspace…' : pending ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}</button>
        </form>
        {session?.googleEnabled && <><div className="divider">or</div><button className="button secondary full" onClick={google} disabled={pending}>Continue with Google</button></>}
        <p className="auth-switch">{signup ? 'Already have an account?' : 'New to CloudSentinel?'} <Link to={signup ? '/login' : '/signup'}>{signup ? 'Sign in' : 'Create an account'}</Link></p>
      </div>
      <p className="auth-foot"><ShieldCheck size={16} /> Local workspace</p>
    </div>
    <div className="auth-art">
      <div className="auth-art-top"><AudioLines size={17} /> CLOUD SECURITY OBSERVATORY</div>
      <NetworkVisual auth />
      <div className="auth-art-bottom"><strong>Cloud posture.<br /><em>In focus.</em></strong></div>
    </div>
  </main>;
}

function Protected() {
  const { session, api, authenticate, connectionError, refresh } = useContext(Auth);
  const navigate = useNavigate();
  if (!session) return <main className="loading-screen" id="main"><Brand /><p role="status">{connectionError || 'Opening workspace…'}</p>{connectionError && <button className="button secondary" onClick={refresh}>Retry</button>}</main>;
  if (!session.user) return <Navigate to="/login" replace />;
  async function logout() {
    await authenticate('logout', {});
    navigate('/login', { replace: true });
  }
  return <Suspense fallback={<main className="loading-screen" id="main"><Brand /><p role="status">Opening workspace…</p></main>}>
    <Dashboard user={session.user} api={api} onLogout={logout} />
  </Suspense>;
}

function App() {
  const location = useLocation();
  const group = location.pathname.startsWith('/workspace') ? 'workspace' : location.pathname;
  useEffect(() => {
    if (group !== 'workspace') window.scrollTo(0, 0);
  }, [group]);
  return <><a className="skip-link" href="#main">Skip to content</a><AnimatePresence mode="wait" initial={false}>
    <motion.div className="route" key={group} initial={{ opacity: .84 }} animate={{ opacity: 1 }} exit={{ opacity: .9 }} transition={{ duration: .14 }}>
      <Routes location={location}>
        <Route index element={<Landing />} />
        <Route path="/login" element={<AuthScreen />} />
        <Route path="/signup" element={<AuthScreen signup />} />
        <Route path="/workspace/*" element={<Protected />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </motion.div>
  </AnimatePresence></>;
}

createRoot(document.getElementById('root')).render(
  <MotionConfig reducedMotion="user"><BrowserRouter><AuthProvider><App /></AuthProvider></BrowserRouter></MotionConfig>
);
