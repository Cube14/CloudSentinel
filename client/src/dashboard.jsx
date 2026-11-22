import React, { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Activity, Box, ChevronDown, CircleAlert, Clock3, Fingerprint, Gauge, ListChecks, LogOut, Radar, ScanLine, Shield, ShieldAlert, Terminal } from 'lucide-react';
import { Brand } from './brand';

const nav = [
  ['Overview', '', Gauge], ['Findings', 'findings', ShieldAlert], ['Assets', 'assets', Box],
  ['Identity', 'identity', Fingerprint], ['Threats', 'threats', Radar], ['Audit trail', 'audit', ListChecks]
];
const severities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const time = value => value ? new Date(value).toLocaleString() : '—';
const scope = (path, id) => id ? path + '?environment=' + encodeURIComponent(id) : path;
const sourceName = (data, id) => data.environments.find(source => source.id === id)?.label || id;
const statusLabels = { succeeded: 'Succeeded', failed: 'Failed', running: 'Running', queued: 'Queued', idle: 'Awaiting scan' };

function Pill({ value, children }) {
  return <span className={'pill tone-' + value?.toLowerCase()}>{children || value}</span>;
}

function Table({ headers, rows, empty = 'No records in this environment.' }) {
  return <div className="table-scroll"><table><thead><tr>{headers.map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
    <tbody>{rows.length ? rows.map(({ key, cells }) => <tr key={key}>{cells.map((cell, index) => <td key={index}>{cell ?? '—'}</td>)}</tr>)
      : <tr><td colSpan={headers.length} className="empty-row">{empty}</td></tr>}</tbody></table></div>;
}

function Panel({ title, icon: Icon, meta, children }) {
  return <section className="panel"><div className="panel-head"><h2>{Icon && <Icon size={18} strokeWidth={1.7} />}{title}</h2>{meta && <span>{meta}</span>}</div>{children}</section>;
}

function FindingTable({ data, findings, resolved = false }) {
  return <Table headers={['Severity', 'Finding', 'Resource / source', 'Evidence', resolved ? 'Resolved' : 'First detected']}
    empty={resolved ? 'No resolved findings.' : 'No findings in the available snapshot.'}
    rows={findings.map(f => ({ key: f.id, cells: [
      <Pill value={f.severity} />,
      <><strong>{f.title}</strong><small>{f.ruleId}</small><small>{f.recommendation}</small></>,
      <><strong>{f.resource}</strong><small>{sourceName(data, f.environment)}</small></>,
      <span className="evidence">{f.evidence}</span>, time(resolved ? f.resolvedAt : f.detectedAt)
    ] }))} />;
}

function Overview({ data }) {
  const { summary, findings, history } = data;
  const values = [
    ['Posture score', summary.score, Shield, 'of 100'],
    ['Monitored assets', summary.assets, Box],
    ['Open findings', summary.findings, Radar],
    ['Critical findings', summary.critical, ShieldAlert]
  ];
  return <>
    <div className="metrics">{values.map(([label, value, Icon, suffix]) => <div className="metric" key={label}>
      <div><span>{label}</span><Icon size={18} strokeWidth={1.6} /></div>
      <strong>{value ?? '—'}{suffix && value !== null && <small>{suffix}</small>}</strong>
    </div>)}</div>
    <div className="overview-grid">
      <Panel title="Environment health" icon={Activity} meta={summary.providers.length + ' sources'}>
        <Table headers={['Environment', 'Status', 'Last success', 'Findings']} rows={summary.providers.map(source => ({
          key: source.id, cells: [<><strong>{source.label}</strong><small>{source.kind === 'fixture' ? 'Simulated fixture' : 'Local emulator'}</small></>,
            <><Pill value={source.status}>{statusLabels[source.status]}</Pill>{source.error && <small className="failed-text">{source.error}</small>}</>,
            time(source.lastSuccess), source.findings]
        }))} />
      </Panel>
      <Panel title="Finding severity" icon={Radar}>
        {summary.findings === null ? <p className="panel-empty">Awaiting the first successful scan.</p>
          : <div className="severity-chart">{severities.map(level => {
            const count = findings.filter(finding => finding.severity === level).length;
            return <div key={level}><Pill value={level} /><progress className={'tone-' + level.toLowerCase()} value={count}
              max={Math.max(findings.length, 1)} aria-label={level + ' findings'} /><b>{count}</b></div>;
          })}</div>}
      </Panel>
    </div>
    <Panel title="Priority findings" icon={ShieldAlert}><FindingTable data={data} findings={findings
      .filter(f => ['CRITICAL', 'HIGH'].includes(f.severity))
      .sort((a, b) => severities.indexOf(a.severity) - severities.indexOf(b.severity)).slice(0, 6)} /></Panel>
    <Panel title="Scan timeline" icon={Clock3}><Table headers={['Finished', 'Environment', 'Result', 'Findings']}
      rows={history.slice(0, 14).map((run, index) => ({ key: run.environment + run.finishedAt + index,
        cells: [time(run.finishedAt), sourceName(data, run.environment), <><Pill value={run.status}>{statusLabels[run.status]}</Pill>
          {run.error && <small className="failed-text">{run.error}</small>}</>, run.findings] }))} /></Panel>
  </>;
}

function Assets({ data }) {
  return <Panel title="Normalized inventory" icon={Box} meta={data.assets.length + ' assets'}>
    <Table headers={['Resource', 'Type', 'Environment', 'Configuration']} rows={data.assets.map(asset => {
      const { id, name, environment, source, provider, type, ...configuration } = asset;
      return { key: [environment, type, id].join(':'), cells: [
        <><strong>{name}</strong><small>{id}</small></>, type, sourceName(data, environment),
        <details><summary>View configuration</summary><pre>{JSON.stringify(configuration, null, 2)}</pre></details>
      ] };
    })} />
  </Panel>;
}

const responseActions = [['DISABLE_ACCESS_KEY', 'Disable access key'], ['REMOVE_POLICY', 'Remove policy'],
  ['QUARANTINE_INSTANCE', 'Quarantine instance']];

function Incident({ incident, admin, api, environment, update }) {
  const [analysis, setAnalysis] = useState(null);
  const [proposed, setProposed] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const base = '/api/incidents/' + incident.id;
  async function investigate() {
    setBusy('investigate');
    setError('');
    try {
      setAnalysis(await api(scope(base + '/investigate', environment), {}));
    } catch (error) { setError(error.message); }
    finally { setBusy(''); }
  }
  async function respond(decision) {
    setBusy('respond');
    setError('');
    try {
      const result = await api(scope(base + '/respond', environment), { action: proposed, decision });
      setConfirmation(result.status === 'REJECTED' ? 'Rejection recorded in the audit trail.' : 'Simulated approval recorded in the audit trail.');
      setProposed(null);
      update();
    } catch (error) { setError(error.message); }
    finally { setBusy(''); }
  }
  return <Panel title={incident.actor} icon={Radar} meta={incident.id}>
    <div className="incident-info"><Pill value={incident.severity} /><span>{incident.environment}</span><p>{incident.summary}</p>
      <div className="attack-chain">{incident.attackStages.map(stage => <span key={stage}>{stage}</span>)}</div>
    </div>
    <Table headers={['Time', 'Event', 'Target', 'Source']} rows={incident.events.map((event, index) => ({
      key: event.eventId || index, cells: [time(event.timestamp), event.action, event.resource, event.source]
    }))} />
    {admin && <div className="incident-actions"><button className="button secondary small" onClick={investigate} disabled={!!busy}>
      <Terminal size={16} />{busy === 'investigate' ? 'Investigating…' : 'Investigate incident'}</button>
      <label>Simulated response <select value={proposed || ''} onChange={event => { setProposed(event.target.value || null); setConfirmation(''); }}>
        <option value="">Select an action</option>{responseActions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select></label>
      {proposed && <><button className="button primary small" disabled={!!busy} onClick={() => respond('approve')}>Approve simulation</button>
        <button className="button secondary small" disabled={!!busy} onClick={() => respond('reject')}>Record rejection</button></>}
    </div>}
    {error && <p className="feedback error inset" role="alert">{error}</p>}
    {confirmation && <p className="feedback inset" role="status">{confirmation}</p>}
    {analysis && <div className="analysis" role="status">
      <h3>Investigation <Pill value={analysis.mode}>{analysis.mode === 'ollama' ? 'Local Ollama' : 'Rule-based fallback'}</Pill></h3>
      <p>{analysis.summary}</p>
      {[['Recorded evidence', analysis.observations], ['Hypotheses to verify', analysis.hypotheses], ['Verification steps', analysis.recommendations]]
        .map(([title, values]) => <div key={title}><h4>{title}</h4><ul>{values.map((value, index) => <li key={index}>{value}</li>)}</ul></div>)}
      {analysis.warning && <p>{analysis.warning}</p>}
    </div>}
  </Panel>;
}

function Threats({ data, admin, api, environment, update, reportError }) {
  const [replaying, setReplaying] = useState(false);
  const emulator = data.summary.providers.length === 1 && data.summary.providers[0].kind === 'emulator';
  async function replay() {
    setReplaying(true);
    try { await api('/api/simulations/run', {}); update(); }
    catch (error) { reportError(error.message); }
    finally { setReplaying(false); }
  }
  if (emulator) return <Panel title="Incident evidence" icon={Radar}><p className="panel-empty">Event collection is unavailable for the Floci source.</p></Panel>;
  return <>{admin && <button className="button secondary replay" onClick={replay} disabled={replaying}>{replaying ? 'Replaying…' : 'Replay fixture events'}</button>}
    {data.incidents.length ? data.incidents.map(incident => <Incident key={incident.id + JSON.stringify(incident.events)}
      {...{ incident, admin, api, environment, update }} />)
      : <Panel title="Incident evidence" icon={Radar}><p className="panel-empty">No incidents in this environment.</p></Panel>}
  </>;
}

function Audit({ data, admin, api }) {
  const [security, setSecurity] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!admin) return;
    const controller = new AbortController();
    api('/api/auth/audit', undefined, controller.signal).then(setSecurity).catch(error => {
      if (!controller.signal.aborted) setError(error.message);
    });
    return () => controller.abort();
  }, [api, admin]);
  return <>
    <Panel title="Simulated responses" icon={ListChecks}><Table headers={['Time', 'Environment', 'Decision', 'Action', 'Analyst', 'Result']}
      rows={data.audit.map(a => ({ key: a.id, cells: [time(a.timestamp), a.sourceEnvironment, a.decision, a.action, a.approvedBy, a.status] }))} /></Panel>
    {admin && <Panel title="Account activity" icon={Fingerprint}>{error ? <p className="feedback error inset">{error}</p>
      : security ? <Table headers={['Time', 'Event', 'Account']} rows={security.map(entry => ({
        key: entry.id, cells: [time(entry.timestamp), entry.action, entry.actor]
      }))} /> : <p className="panel-empty">Loading account activity…</p>}</Panel>}
  </>;
}

export function Dashboard({ user, api, onLogout }) {
  const location = useLocation();
  const [environment, setEnvironment] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  const [environments, setEnvironments] = useState([]);
  const [fetchError, setFetchError] = useState('');
  const [actionError, setActionError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const admin = user.role === 'admin';
  const data = snapshot?.environment === environment ? snapshot?.data : null;
  const destination = location.pathname.split('/')[2] || '';
  const label = nav.find(([, id]) => id === destination)?.[0] || 'Overview';
  const update = () => setRefresh(value => value + 1);

  useEffect(() => {
    const controller = new AbortController();
    let timer;
    async function poll() {
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(7000)]);
        const data = await api(scope('/api/dashboard', environment), undefined, signal);
        if (!controller.signal.aborted) {
          setSnapshot({ environment, data });
          setEnvironments(data.environments);
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

  async function run() {
    setScanning(true);
    setActionError('');
    try { await api(scope('/api/scans/run', environment), {}); }
    catch (error) { setActionError(error.message); }
    finally { setScanning(false); update(); }
  }
  async function logout() {
    try { await onLogout(); }
    catch (error) { setActionError(error.message); }
  }

  const failures = data?.summary.providers.filter(source => source.status === 'failed') || [];
  const active = data?.summary.providers.some(source => ['running', 'queued'].includes(source.status));
  return <div className="workspace">
    <aside className="sidebar">
      <Brand />
      <nav aria-label="Workspace navigation">{nav.map(([label, route, Icon]) =>
        <NavLink key={route} to={'/workspace' + (route ? '/' + route : '')} end>
          <Icon size={18} strokeWidth={1.75} />{label}
        </NavLink>)}</nav>
      <div className="profile">
        <span className="profile-avatar" aria-hidden="true">{user.email[0].toUpperCase()}</span>
        <div><strong title={user.email}>{user.email}</strong><small>{user.role}</small></div>
        <button className="icon-button" onClick={logout} title="Sign out" aria-label="Sign out"><LogOut size={17} /></button>
      </div>
    </aside>
    <main className="workspace-main" id="main">
      <header className="workspace-top"><div className="workspace-breadcrumb">Workspace <span>/</span> {label}</div>
        <span className="system-state"><span className={'status-dot' + (failures.length || fetchError ? ' warning-dot' : '')} />
          {fetchError ? 'Disconnected' : failures.length ? 'Source issues' : active || scanning ? 'Scan running' : data ? 'Connected' : 'Connecting'}</span>
      </header>
      <div className="workspace-content">
        <div className="workspace-title">
          <div><p className="eyebrow"><span className="signal-line" /> SECURITY OPERATIONS</p><h1>{label === 'Overview' ? 'Security overview' : label}</h1></div>
          <div className="workspace-controls"><label><span>Environment</span><span className="select-wrap">
            <select value={environment} onChange={event => { setEnvironment(event.target.value); setActionError(''); setFetchError(''); }}>
              <option value="">All environments</option>{environments.map(source => <option key={source.id} value={source.id}>{source.label}</option>)}
            </select><ChevronDown size={16} aria-hidden="true" /></span></label>
            {admin && <button className="button primary" onClick={run} disabled={scanning}><ScanLine size={18} className={scanning ? 'scanning-icon' : ''} />{scanning ? 'Scanning…' : 'Run scan'}</button>}
          </div>
        </div>
        {data && <div className="scan-strip" role="status"><span><Clock3 size={16} /> Last successful scan <strong>{time(data.summary.lastScan)}</strong></span>
          <span>Scheduled every {data.intervalMs / 1000} s{active || scanning ? ' · Scan in progress' : ''}</span></div>}
        {failures.length > 0 && <div className="feedback error" role="status"><CircleAlert size={18} /><div><strong>Scan failed. Available figures reflect the last successful snapshot.</strong>
          {failures.map(source => <div key={source.id}>{source.label} · {source.error}</div>)}</div></div>}
        {(actionError || fetchError) && <div className="feedback error" role="alert"><CircleAlert size={18} />{actionError || ('Dashboard refresh failed: ' + fetchError)}</div>}
        {data ? <AnimatePresence mode="wait" initial={false}><motion.div className="dashboard-view" key={destination}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .14 }}>
          <Routes location={location}>
            <Route index element={<Overview data={data} />} />
            <Route path="findings" element={<><Panel title="Open findings" icon={ShieldAlert} meta={data.findings.length}><FindingTable data={data} findings={data.findings} /></Panel>
              <Panel title="Resolved findings" icon={ListChecks} meta={data.resolved.length}><FindingTable data={data} findings={data.resolved} resolved /></Panel></>} />
            <Route path="assets" element={<Assets data={data} />} />
            <Route path="identity" element={<Panel title="Identity and access findings" icon={Fingerprint}><FindingTable data={data} findings={data.findings
              .filter(f => f.ruleId.startsWith('IAM-') || ['CSPM-006', 'CSPM-007'].includes(f.ruleId))} /></Panel>} />
            <Route path="threats" element={<Threats {...{ data, admin, api, environment, update }} reportError={setActionError} />} />
            <Route path="audit" element={<Audit {...{ data, admin, api }} />} />
            <Route path="*" element={<Navigate to="/workspace" replace />} />
          </Routes>
        </motion.div></AnimatePresence> : <div className="panel loading-panel" role="status">{fetchError ? 'Waiting for the API to reconnect…' : 'Loading environment…'}</div>}
      </div>
    </main>
  </div>;
}
