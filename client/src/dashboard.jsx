import React, { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Activity, Box, ChevronDown, CircleAlert, Clock3, Fingerprint, Gauge, ListChecks, LogOut, PanelLeftClose, PanelLeftOpen, Radar, ScanLine, ShieldAlert } from 'lucide-react';
import { Brand } from './brand';
import { Assets, Audit, Findings, Overview, RecordDetails } from './workspace-views';
import { Threats } from './workspace-threats';
import { scope, time } from './workspace-ui';
import './workspace.css';

const navigation = [
  ['Monitoring', [['Overview', '', Gauge], ['Findings', 'findings', ShieldAlert], ['Assets', 'assets', Box], ['Identity', 'identity', Fingerprint]]],
  ['Operations', [['Threats', 'threats', Radar], ['Audit trail', 'audit', ListChecks]]]
];

function Sidebar({ user, collapsed, toggle, logout }) {
  const Toggle = collapsed ? PanelLeftOpen : PanelLeftClose;
  return <aside className="sidebar">
    <div className="sidebar-top"><Brand /><button type="button" className="icon-button sidebar-toggle"
      onClick={toggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed}><Toggle size={18} /></button></div>
    <nav aria-label="Workspace navigation">{navigation.map(([label, items]) => <div className="nav-group" key={label}>
      <p>{label}</p>
      {items.map(([name, route, Icon]) => <NavLink key={route} to={'/workspace' + (route ? '/' + route : '')} end title={name} aria-label={name}>
        {({ isActive }) => <>{isActive && <motion.span className="active-nav" layoutId="active-nav" transition={{ duration: .22 }} />}
          <Icon size={18} strokeWidth={1.65} /><span className="nav-label">{name}</span></>}
      </NavLink>)}
    </div>)}</nav>
    <div className="sidebar-bottom">
      <div className="profile"><span className="profile-avatar" aria-hidden="true">{user.email[0].toUpperCase()}</span>
        <div className="profile-identity"><strong title={user.email}>{user.email}</strong><small>{user.role}</small></div>
        <button type="button" className="icon-button" onClick={logout} title="Sign out" aria-label="Sign out"><LogOut size={18} /></button>
      </div>
    </div>
  </aside>;
}

function Skeleton({ disconnected }) {
  return <div className="skeleton-board" role="status" aria-label={disconnected ? 'Waiting for the API to reconnect' : 'Loading environment'}>
    <div /><div /><div /><div />
  </div>;
}

export function Dashboard({ user, api, onLogout }) {
  const location = useLocation();
  const [environment, setEnvironment] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  const [environments, setEnvironments] = useState([]);
  const [fetchError, setFetchError] = useState('');
  const [actionError, setActionError] = useState(null);
  const [scanning, setScanning] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [record, setRecord] = useState(null);
  const [collapsed, setCollapsed] = useState(() => {
    const stored = localStorage.getItem('cloudsentinel.sidebar');
    return stored === null ? matchMedia('(max-width: 1050px)').matches : stored === 'true';
  });
  const admin = user.role === 'admin';
  const data = snapshot?.environment === environment ? snapshot?.data : null;
  const destination = location.pathname.split('/')[2] || '';
  const label = navigation.flatMap(([, items]) => items).find(([, id]) => id === destination)?.[0] || 'Overview';
  const update = () => setRefresh(value => value + 1);
  const scopeError = actionError?.environment === environment ? actionError.message : '';

  useEffect(() => {
    const controller = new AbortController();
    let timer;
    async function poll() {
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(7000)]);
        const next = await api(scope('/api/dashboard', environment), undefined, signal);
        if (!controller.signal.aborted) {
          setSnapshot({ environment, data: next });
          setEnvironments(next.environments);
          setFetchError('');
        }
      } catch (error) {
        if (!controller.signal.aborted) setFetchError(error.message);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 2000);
      }
    }
    poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [api, environment, refresh]);

  function reportError(message) { setActionError({ environment, message }); }
  async function run() {
    setScanning(environment);
    setActionError(null);
    try { await api(scope('/api/scans/run', environment), {}); }
    catch (error) { reportError(error.message); }
    finally { setScanning(null); update(); }
  }
  async function logout() {
    try { await onLogout(); }
    catch (error) { reportError(error.message); }
  }
  function toggleSidebar() {
    localStorage.setItem('cloudsentinel.sidebar', String(!collapsed));
    setCollapsed(!collapsed);
  }

  const failures = data?.summary.providers.filter(source => source.status === 'failed') || [];
  const active = data?.summary.providers.some(source => ['running', 'queued'].includes(source.status)) || scanning === environment;
  const state = fetchError ? 'Disconnected' : failures.length ? 'Source issues' : active ? 'Scan running' : data ? 'Connected' : 'Connecting';

  return <div className={'workspace' + (collapsed ? ' workspace-collapsed' : '')}>
    <Sidebar user={user} collapsed={collapsed} toggle={toggleSidebar} logout={logout} />
    <main className="workspace-main" id="main">
      <header className="workspace-top">
        <div className="workspace-breadcrumb">Workspace <span>/</span> {label}</div>
        <span className="system-state"><span className={'status-dot' + (fetchError || failures.length ? ' warning-dot' : '')} />
          {state}</span>
      </header>
      <div className="workspace-content">
        <div className="workspace-title">
          <div><p className="eyebrow"><Activity size={15} /> SECURITY OPERATIONS</p><h1>{label === 'Overview' ? 'Security overview' : label}</h1></div>
          <div className="workspace-controls">
            <label><span>Environment</span><span className="select-wrap"><select value={environment} onChange={event => {
              setEnvironment(event.target.value); setRecord(null); setFetchError('');
            }}><option value="">All environments</option>{environments.map(source =>
              <option key={source.id} value={source.id}>{source.label}</option>)}</select><ChevronDown size={15} aria-hidden="true" /></span></label>
            {admin && <button type="button" className="button primary" onClick={run} disabled={scanning !== null}><ScanLine size={17}
              className={scanning !== null ? 'scanning-icon' : ''} />{scanning !== null ? 'Scanning…' : 'Run scan'}</button>}
          </div>
        </div>
        <div className={'scan-strip' + (active ? ' scan-active' : '')} aria-live="polite">
          <span><Clock3 size={16} /> Last successful scan <strong>{time(data?.summary.lastScan)}</strong></span>
          <span>{active ? 'Scan in progress' : data ? 'Scheduled every ' + data.intervalMs / 1000 + ' s' : 'Awaiting snapshot'}</span>
          {active && <span className="loading-line" />}
        </div>
        {!!failures.length && <div className="feedback error" role="status"><CircleAlert size={19} /><div>
          <strong>Scan failed. Available figures reflect the last successful snapshot.</strong>
          {failures.map(source => <div key={source.id}>{source.label} · {source.error}</div>)}</div></div>}
        {(scopeError || fetchError) && <div className="feedback error" role="alert"><CircleAlert size={18} />
          {scopeError || ('Dashboard refresh failed: ' + fetchError)}</div>}
        {data ? <AnimatePresence mode="wait" initial={false}><motion.div className="dashboard-view" key={destination}
          initial={{ opacity: .68, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: .65 }} transition={{ duration: .15 }}>
          <Routes location={location}>
            <Route index element={<Overview data={data} open={setRecord} />} />
            <Route path="findings" element={<Findings data={data} open={setRecord} />} />
            <Route path="assets" element={<Assets data={data} open={setRecord} />} />
            <Route path="identity" element={<Findings data={data} open={setRecord} identity />} />
            <Route path="threats" element={<Threats {...{ data, admin, api, environment, update, reportError }} />} />
            <Route path="audit" element={<Audit {...{ data, admin, api }} />} />
            <Route path="*" element={<Navigate to="/workspace" replace />} />
          </Routes>
        </motion.div></AnimatePresence> : <Skeleton disconnected={!!fetchError} />}
      </div>
    </main>
    <RecordDetails record={record} data={data} close={() => setRecord(null)} />
  </div>;
}
