import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { RevealAccent } from './reveal-accent';
import { constellationState } from './constellation-state';
import { useMotionDirector } from './motion-director';
import { motion, useReducedMotion } from 'motion/react';
import { Activity, Bot, Box, ChevronDown, CircleAlert, Clock3, Fingerprint, Gauge, ListChecks, LogOut, PanelLeftClose, PanelLeftOpen, Radar, ScanLine, Server, ShieldAlert, Waypoints } from 'lucide-react';
import { Brand } from './brand';
import { Assets, Audit, Environments, Findings, Overview, RecordDetails } from './workspace-views';
import { Threats } from './workspace-threats';
import { SpatialStage, Topology } from './topology';
import { scope, sourceTypes, time } from './workspace-ui';
import './workspace.css';

const navigation = [
  ['Monitoring', [['Overview', '', Gauge], ['Environments', 'environments', Server], ['Topology', 'topology', Waypoints], ['Findings', 'findings', ShieldAlert], ['Assets', 'assets', Box], ['Identity', 'identity', Fingerprint]]],
  ['Operations', [['Threats', 'threats', Radar], ['AI Analyst', 'analyst', Bot], ['Audit trail', 'audit', ListChecks]]]
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

function RouteReveal({ director, destination, cinematic }) {
  const ref = useRef(null);
  useEffect(() => {
    if (cinematic) return director.reveal(ref.current);
  }, [director, destination, cinematic]);
  return <div className="workspace-route-reveal" ref={ref} aria-hidden="true">
    {cinematic && <RevealAccent />}
  </div>;
}

function Skeleton({ disconnected }) {
  return <div className="skeleton-board" role="status" aria-label={disconnected ? 'Waiting for the API to reconnect' : 'Loading environment'}>
    <div /><div /><div /><div />
  </div>;
}

export function Dashboard({ user, api, onLogout }) {
  const location = useLocation();
  const workspace = useRef(null);
  const reducedMotion = useReducedMotion();
  const [effects, setEffects] = useState(() => localStorage.getItem('cloudsentinel.effects') !== 'off');
  const cinematic = effects && !reducedMotion;
  const director = useMotionDirector(workspace, cinematic);
  function toggleEffects() {
    setEffects(!effects);
    localStorage.setItem('cloudsentinel.effects', effects ? 'off' : 'on');
  }
  const [environment, setEnvironment] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  const [environments, setEnvironments] = useState([]);
  const [fetchError, setFetchError] = useState('');
  const [actionError, setActionError] = useState(null);
  const [scanning, setScanning] = useState(null);
  const [settledScan, setSettledScan] = useState(null);
  const [sweep, setSweep] = useState(null);
  const overviewIntro = useRef({ titlePlayed: false, cameraPlayed: false, manualScan: null, result: null });
  const [refresh, setRefresh] = useState(0);
  const [record, setRecord] = useState(null);
  const [collapsed, setCollapsed] = useState(() => {
    const stored = localStorage.getItem('cloudsentinel.sidebar');
    return stored === null ? matchMedia('(max-width: 1050px)').matches : stored === 'true';
  });
  const admin = user.role === 'admin';
  const data = snapshot?.environment === environment ? snapshot?.data : null;
  const openRecord = useCallback(record => {
    if (record.type === 'finding') {
      const finding = data?.findings.find(entry => entry.id === record.id) || data?.resolved.find(entry => entry.id === record.id);
      if (finding?.severity === 'CRITICAL') director.play('critical');
    }
    setRecord(record);
  }, [data, director]);
  const destination = location.pathname.split('/')[2] || '';
  useEffect(() => { window.scrollTo(0, 0); }, [destination]);
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
        if (!controller.signal.aborted) {
          if (settledScan) setScanning(current => current === settledScan ? null : current);
          timer = setTimeout(poll, 2000);
        }
      }
    }
    poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [api, environment, refresh, settledScan]);

  function reportError(message) { setActionError({ environment, message }); }
  async function run() {
    const request = { scope: environment, at: performance.now() };
    setScanning(request);
    setSweep(request);
    setActionError(null);
    try { await api(scope('/api/scans/run', environment), {}); }
    catch (error) { reportError(error.message); }
    finally { setSettledScan(request); }
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
  const disconnected = data?.summary.providers.filter(source => source.status === 'not-connected') || [];
  const incomplete = data?.summary.providers.filter(source => source.coverage === 'partial' || source.warnings?.length) || [];
  const selectedSource = environments.find(source => source.id === environment);
  const active = data?.summary.providers.some(source => ['running', 'queued'].includes(source.status));
  const requesting = scanning?.scope === environment;
  const state = fetchError ? 'Disconnected' : selectedSource?.status === 'not-connected' ? 'Not connected' :
    active ? 'Scan running' : requesting ? 'Requesting scan' : failures.length || incomplete.length ? 'Source issues' :
      selectedSource?.connection === 'configured' ? 'Awaiting scan' : data ? 'Connected' : 'Connecting';

  const scan = constellationState({
    requesting, active, failed: !!(scopeError || failures.length), partial: !!incomplete.length,
    disconnected: !!(fetchError || disconnected.length), lastScan: data?.summary.lastScan,
  });
  const scanToken = sweep?.scope === environment ? sweep.at : null;
  const sourceNotices = <>
    {!!failures.length && <div className="feedback error" role="status"><CircleAlert size={19} /><div>
      <strong>Scan failed. Available figures reflect previous scan snapshots.</strong>
      {failures.map(source => <div key={source.id}>{source.label} · {source.error}</div>)}</div></div>}
    {!!disconnected.length && <div className="feedback warning" role="status"><CircleAlert size={19} /><div><strong>Source not connected</strong>
      {disconnected.map(source => <div key={source.id}>{source.label} · {source.error}</div>)}</div></div>}
    {!!incomplete.length && <div className="feedback warning" role="status"><CircleAlert size={19} /><div><strong>Coverage warnings</strong>
      {incomplete.map(source => <div key={source.id}>{source.label} · Latest snapshot {time(source.lastSnapshot)}
        {source.coverage === 'partial' && ' · Unverified findings remain open.'}
        {source.warnings?.map(warning => <div key={JSON.stringify(warning)}>
          {[warning.service, warning.region, warning.operation, warning.code].filter(Boolean).join(' · ')}
          {warning.count > 1 && ' × ' + warning.count}
        </div>)}
      </div>)}</div></div>}
  </>;
  return <div ref={workspace} className={'workspace' + (collapsed ? ' workspace-collapsed' : '') + ' workspace-spatial workspace-cinematic'}
    data-effects={cinematic ? 'on' : 'off'}>
    <Sidebar user={user} collapsed={collapsed} toggle={toggleSidebar} logout={logout} />
    <main className="workspace-main" id="main">
      <header className="workspace-top">
        <div className="workspace-breadcrumb">Workspace <span>/</span> {label}</div>
        <div className="workspace-status"><button className="effects-toggle" type="button" aria-pressed={cinematic}
          disabled={!!reducedMotion} onClick={toggleEffects}>Effects {cinematic ? 'on' : 'off'}</button><span className="system-state"><span className={'status-dot' + (fetchError || failures.length ? ' warning-dot' :
          incomplete.length || (selectedSource && disconnected.length) ? ' coverage-dot' : '')} />
          {state}</span></div>
      </header>
      <div className="workspace-content">
        <div className="workspace-title">
          <div><p className="eyebrow"><Activity size={15} /> SECURITY OPERATIONS</p>
            <h1>{label === 'Overview' ? 'Security overview' : label === 'Topology' ? 'Cloud topology' : label}</h1></div>
          <div className="workspace-controls">
            <label><span>Environment</span><span className="select-wrap"><select value={environment} onChange={event => {
              setEnvironment(event.target.value); setRecord(null); setFetchError('');
            }}><option value="">All environments</option>{environments.map(source =>
              <option key={source.id} value={source.id}>{source.label} · {sourceTypes[source.kind]}</option>)}</select><ChevronDown size={15} aria-hidden="true" /></span></label>
            {admin && <button type="button" className="button primary" onClick={run}
              disabled={scanning !== null || selectedSource?.scanEnabled === false}><ScanLine size={17}
              className={scanning !== null ? 'scanning-icon' : ''} />{scanning !== null ? 'Scanning…' : 'Run scan'}</button>}
          </div>
        </div>
        <div className={'scan-strip' + (active ? ' scan-active' : '')} aria-live="polite">
          <span><Clock3 size={16} /> Last successful scan <strong>{time(data?.summary.lastScan)}</strong></span>
          <span>{active ? 'Scan in progress' : requesting ? 'Requesting scan…' : selectedSource?.scanEnabled === false ? 'Not connected' :
            selectedSource?.schedule === false ? 'Manual scans only' : data ? 'Scheduled every ' + data.intervalMs / 1000 + ' s' : 'Awaiting snapshot'}</span>
          {requesting && <span className="loading-line" />}
        </div>
        {snapshot?.data && <SpatialStage data={data || snapshot.data} open={openRecord} intro={overviewIntro}
          loading={!data} pending={requesting || !!active} sourceLabel={selectedSource?.label || 'All environments'}
          {...{ scan, scanToken, environment, director, cinematic, destination }} />}
        {(scopeError || fetchError) && <div className="feedback error" role="alert"><CircleAlert size={18} />
          {scopeError || ('Dashboard refresh failed: ' + fetchError)}</div>}
        {data ? <div className="dashboard-view destination-panel" id="workspace-operations" aria-label={label + ' operations'} tabIndex={-1}>
          <RouteReveal key={destination} director={director} destination={destination} cinematic={cinematic} />
          {destination && destination !== 'topology' && sourceNotices}
          <Routes location={location}>
            <Route index element={<Overview data={data} open={openRecord} notices={sourceNotices} />} />
            <Route path="environments" element={<Environments data={data} />} />
            <Route path="topology" element={<Topology data={data} open={openRecord} {...{ active, scan, scanToken, environment, cinematic }} />} />
            <Route path="findings" element={<Findings data={data} open={openRecord} />} />
            <Route path="assets" element={<Assets data={data} open={openRecord} />} />
            <Route path="identity" element={<Findings data={data} open={openRecord} identity />} />
            <Route path="threats" element={<Threats {...{ data, admin, api, environment, update, reportError, director, cinematic }} />} />
            <Route path="analyst" element={<Threats analystFirst {...{ data, admin, api, environment, update, reportError, director, cinematic }} />} />
            <Route path="audit" element={<Audit {...{ data, admin, api }} />} />
            <Route path="*" element={<Navigate to="/workspace" replace />} />
          </Routes>
        </div> : <Skeleton disconnected={!!fetchError} />}
      </div>
    </main>
    <RecordDetails record={record} data={data} close={() => setRecord(null)} />
  </div>;
}
