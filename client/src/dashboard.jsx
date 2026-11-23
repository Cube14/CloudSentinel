import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { constellationState } from './constellation-state';
import { useMotionDirector } from './motion-director';
import { useCarouselDirector } from './carousel-director';
import { destinationFromPath, phases } from './carousel-state';
import { CarouselWorld, DestinationPage } from './carousel-world';
import { useReducedMotion } from 'motion/react';
import { ChevronDown, CircleAlert, Clock3, ScanLine } from 'lucide-react';
import { Assets, Audit, Environments, Findings, Overview, RecordDetails } from './workspace-views';
import { Threats } from './workspace-threats';
import { Topology } from './topology';
import { scope, sourceTypes, time } from './workspace-ui';
import './workspace.css';

function Skeleton({ disconnected }) {
  return <div className="skeleton-board" role="status" aria-label={disconnected ? 'Waiting for the API to reconnect' : 'Loading environment'}>
    <div /><div /><div /><div />
  </div>;
}

export function Dashboard({ user, api, onLogout }) {
  const location = useLocation();
  const navigate = useNavigate();
  const workspace = useRef(null);
  const reducedMotion = useReducedMotion();
  const [effects, setEffects] = useState(() => localStorage.getItem('cloudsentinel.effects') !== 'off');
  const cinematic = effects && !reducedMotion;
  const director = useMotionDirector(workspace, cinematic);
  const route = destinationFromPath(location.pathname);
  const { machine, page, selected, phase } = useCarouselDirector(route, navigate, cinematic);
  const [showTopology, setShowTopology] = useState(location.pathname.endsWith('/topology'));
  useEffect(() => {
    if ([phases.idle, phases.exiting, phases.entering].includes(phase)) window.scrollTo(0, 0);
  }, [phase]);
  useEffect(() => { setShowTopology(location.pathname.endsWith('/topology')); }, [location.pathname]);
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
  const [refresh, setRefresh] = useState(0);
  const [record, setRecord] = useState(null);
  const admin = user.role === 'admin';
  const data = snapshot?.environment === environment ? snapshot?.data : null;
  const openRecord = useCallback(record => {
    if (record.type === 'finding') {
      const finding = data?.findings.find(entry => entry.id === record.id) || data?.resolved.find(entry => entry.id === record.id);
      if (finding?.severity === 'CRITICAL') director.play('critical');
    }
    setRecord(record);
  }, [data, director]);
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

  function selectEnvironment(id) {
    setEnvironment(id);
    setRecord(null);
    setFetchError('');
  }
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

  const failures = data?.summary.providers.filter(source => source.status === 'failed') || [];
  const disconnected = data?.summary.providers.filter(source => source.status === 'not-connected') || [];
  const incomplete = data?.summary.providers.filter(source => source.coverage === 'partial' || source.warnings?.length) || [];
  const selectedSource = environments.find(source => source.id === environment);
  const active = data?.summary.providers.some(source => ['running', 'queued'].includes(source.status));
  const requesting = scanning?.scope === environment;
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
  const controls = <>
    <div className="destination-scope">
      <label><span>Environment</span><span className="select-wrap"><select value={environment} onChange={event => selectEnvironment(event.target.value)}><option value="">All environments</option>{environments.map(source =>
        <option key={source.id} value={source.id}>{source.label} · {sourceTypes[source.kind]}</option>)}</select><ChevronDown size={15} aria-hidden="true" /></span></label>
      {admin && <button type="button" className="button primary" onClick={run}
        disabled={scanning !== null || selectedSource?.scanEnabled === false}><ScanLine size={17}
        className={requesting && cinematic ? 'scanning-icon' : ''} />{requesting ? 'Scanning…' : 'Run scan'}</button>}
    </div>
    <div className={'scan-strip' + (active ? ' scan-active' : '')} aria-live="polite">
      <span><Clock3 size={16} /> Last successful scan <strong>{time(data?.summary.lastScan)}</strong></span>
      <span>{scan.label}</span>
      {requesting && cinematic && <span className="loading-line" />}
    </div>
    {(scopeError || fetchError) && <div className="feedback error" role="alert"><CircleAlert size={18} />
      {scopeError || ('Dashboard refresh failed: ' + fetchError)}</div>}
  </>;
  let content;
  if (page && data) {
    switch (page.id) {
      case 'overview': content = <Overview data={data} open={openRecord} />; break;
      case 'environments': content = <Environments data={data} onSelect={selectEnvironment} />; break;
      case 'findings': content = <Findings data={data} open={openRecord} />; break;
      case 'assets': content = <>
        <div className="destination-tabs" role="group" aria-label="Asset view">
          <button type="button" aria-pressed={!showTopology} onClick={() => setShowTopology(false)}>Inventory</button>
          <button type="button" aria-pressed={showTopology} onClick={() => setShowTopology(true)}>Resource topology</button>
        </div>
        {showTopology ? <Topology data={data} open={openRecord} {...{ active, scan, scanToken, environment, cinematic }} />
          : <Assets data={data} open={openRecord} />}
      </>; break;
      case 'identity': content = <><Assets data={data} open={openRecord} identity /><Findings data={data} open={openRecord} identity /></>; break;
      case 'threats':
      case 'analyst': content = <Threats analystFirst={page.id === 'analyst'} {...{ data, admin, api, environment, update, reportError, director, cinematic }} />; break;
      case 'audit': content = <Audit {...{ data, admin, api }} />; break;
    }
  }
  const metrics = data && page?.id === 'environments' ? <div className="destination-source-map" role="group" aria-label="Select a cloud source">
    {data.environments.map(source => <button type="button" key={source.id} aria-pressed={environment === source.id}
      onClick={() => selectEnvironment(environment === source.id ? '' : source.id)}>
      <i aria-hidden="true" /><strong>{source.label}</strong><small>{sourceTypes[source.kind]}</small>
    </button>)}
  </div> : data && page?.id === 'overview' && <dl>
    {[['Posture', data.summary.score], ['Assets', data.summary.assets], ['Open findings', data.summary.findings], ['Critical', data.summary.critical]]
      .map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? '—'}</dd></div>)}
  </dl>;
  if (!route && location.pathname !== '/workspace' && location.pathname !== '/workspace/') return <Navigate to="/workspace" replace />;
  return <main id="main" ref={workspace} className="workspace workspace-portal" data-effects={cinematic ? 'on' : 'off'}>
    <CarouselWorld {...{ machine, selected, phase, cinematic, toggleEffects, logout }} reduced={reducedMotion} />
    {page && <DestinationPage key={page.id} destination={page} {...{ phase, machine, cinematic, toggleEffects, metrics }}
      scopeControls={controls} reduced={reducedMotion}>
      {sourceNotices}
      {data ? content : <Skeleton disconnected={!!fetchError} />}
    </DestinationPage>}
    <RecordDetails record={record} data={data} close={() => setRecord(null)} />
  </main>;
}
