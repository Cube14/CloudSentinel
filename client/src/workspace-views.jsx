import React, { useDeferredValue, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Activity, Box, Clock3, Fingerprint, ListChecks, Radar, ShieldAlert } from 'lucide-react';
import { assetKey, DetailButton, Drawer, Empty, Panel, Pill, SearchField, severities, shortTime, sourceName, statuses, Table, time } from './workspace-ui';

const typeNames = { storage: 'Storage', identity: 'Identity', firewall: 'Security group / firewall', compute: 'Compute' };
const matching = (query, values) => values.some(value => String(value ?? '').toLowerCase().includes(query));
const sortedFindings = findings => [...findings].sort((a, b) => severities.indexOf(a.severity) - severities.indexOf(b.severity));
const lifecycle = finding => finding.resolvedAt ? 'Resolved' : 'Open';
const findingAction = (open, finding) => () => open({ type: 'finding', id: finding.id });

function Count({ value, children }) {
  return <motion.strong key={value} initial={{ opacity: .66, y: 3 }} animate={{ opacity: 1, y: 0 }}
    transition={{ duration: .22 }}>{value ?? '—'}{children}</motion.strong>;
}

function Gauge({ score }) {
  return <div className="posture-gauge">
    <svg viewBox="0 0 144 144" aria-hidden="true">
      <circle cx="72" cy="72" r="57" className="dial-grid" />
      <circle cx="72" cy="72" r="65" className="dial-ticks" />
      <circle cx="72" cy="72" r="56" pathLength="100" className="dial-track" transform="rotate(135 72 72)" />
      {score > 0 && <motion.circle cx="72" cy="72" r="56" className="dial-value"
        transform="rotate(135 72 72)" initial={false} animate={{ pathLength: score * .0075 }} transition={{ duration: .6 }} />}
    </svg>
    <div className="dial-label"><Count value={score} />{score !== null && <span>out of 100</span>}</div>
  </div>;
}

function Severity({ findings, summary }) {
  return <Panel title="Severity distribution" icon={Radar} className="severity-sheet"
    action={<span className="panel-meta">Open findings</span>}>
    {summary.findings === null ? <Empty title="Awaiting a successful scan" />
      : <div className="distribution">{severities.map(level => {
        const count = findings.filter(finding => finding.severity === level).length;
        const percent = count / Math.max(1, findings.length) * 100;
        return <div key={level} className={'severity-row severity-' + level.toLowerCase()}>
          <span>{level.toLowerCase()}</span>
          <svg viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true">
            <rect width="100" height="4" />
            <motion.rect initial={false} animate={{ width: percent }} height="4" transition={{ duration: .45 }} />
          </svg>
          <b aria-label={count + ' ' + level.toLowerCase() + ' findings'}>{count}</b>
        </div>;
      })}</div>}
  </Panel>;
}

function FindingRows({ data, findings, open, overview = false }) {
  return <Table headers={overview ? ['Finding', 'Severity', 'Source', ''] : ['Finding', 'Severity', 'Resource', 'State', '']}
    empty="No findings match this view." rows={findings.map(f => ({
      key: f.id, cells: [<button className="record-title" onClick={findingAction(open, f)}>{f.title}<small>{f.ruleId}</small></button>,
        <Pill value={f.severity} />, overview ? sourceName(data, f.environment) :
          <><strong>{f.resource}</strong><small>{sourceName(data, f.environment)}</small></>,
        ...(overview ? [] : [<Pill value={lifecycle(f)} />]),
        <DetailButton name={f.title} onClick={findingAction(open, f)} />]
    }))} />;
}

export function Overview({ data, open }) {
  const { summary, findings, history } = data;
  return <>
    <div className="overview-grid">
      <section className="risk-sheet" aria-labelledby="posture-title">
        <div className="risk-sheet-copy">
          <p className="eyebrow"><Radar size={15} /> POSTURE ASSESSMENT</p>
          <h2 id="posture-title">Overall posture</h2>
          <p>Score from the latest successful scans in this scope.</p>
        </div>
        <Gauge score={summary.score} />
        <div className="risk-stats">
          {[['Monitored assets', summary.assets], ['Open findings', summary.findings], ['Critical', summary.critical], ['Incidents', summary.incidents]].map(([label, value]) =>
            <div key={label} className={label === 'Critical' && value > 0 ? 'critical-stat' : undefined}>
              <span>{label}</span><Count value={value} /></div>)}
        </div>
      </section>
      <Severity findings={findings} summary={summary} />
    </div>
    <div className="overview-grid overview-details">
      <Panel title="Environment health" icon={Activity} action={<span className="panel-meta">{summary.providers.length} in scope</span>}>
        <div className="source-list">{summary.providers.map(source => <div key={source.id} className="source-row">
          <span className="source-icon"><Box size={16} strokeWidth={1.6} /></span>
          <div><strong>{source.label}</strong><span>{source.kind === 'fixture' ? 'Simulated fixture' : 'Local emulator'}</span></div>
          <Pill value={source.status}>{statuses[source.status]}</Pill>
          <time dateTime={source.lastSuccess || undefined} title={time(source.lastSuccess)}>{shortTime(source.lastSuccess)}</time>
        </div>)}</div>
      </Panel>
      <Panel title="Priority findings" icon={ShieldAlert} action={<Link to="/workspace/findings" className="text-link">View all findings</Link>}>
        <FindingRows data={data} open={open} overview findings={sortedFindings(findings)
          .filter(f => ['CRITICAL', 'HIGH'].includes(f.severity)).slice(0, 4)} />
      </Panel>
    </div>
    <Panel title="Scan timeline" icon={Clock3} action={<span className="panel-meta">Most recent runs</span>}>
      <Table headers={['Finished', 'Environment', 'Result', 'Findings']} rows={history.slice(0, 12).map((run, index) => ({
        key: run.environment + run.finishedAt + index, cells: [time(run.finishedAt), sourceName(data, run.environment),
          <><Pill value={run.status}>{statuses[run.status]}</Pill>{run.error && <small className="failed-text">{run.error}</small>}</>, run.findings]
      }))} />
    </Panel>
  </>;
}

export function Findings({ data, open, identity = false }) {
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState('');
  const [status, setStatus] = useState('open');
  const query = useDeferredValue(search.trim().toLowerCase());
  const findingList = status === 'open' ? data.findings : status === 'resolved' ? data.resolved : [...data.findings, ...data.resolved];
  const filtered = sortedFindings(findingList.filter(f =>
    (!identity || f.ruleId.startsWith('IAM-') || ['CSPM-006', 'CSPM-007'].includes(f.ruleId)) &&
    (!severity || f.severity === severity) &&
    matching(query, [f.title, f.resource, f.ruleId, f.evidence, sourceName(data, f.environment)])));
  return <Panel title={identity ? 'Identity and access findings' : 'Findings explorer'} icon={identity ? Fingerprint : ShieldAlert}
    action={<span className="panel-meta" aria-live="polite">{filtered.length} results</span>}>
    <div className="explorer-toolbar">
      <SearchField label="Search findings" value={search} onChange={setSearch} />
      <label>Severity<select value={severity} onChange={event => setSeverity(event.target.value)}>
        <option value="">All severities</option>{severities.map(level => <option key={level}>{level}</option>)}
      </select></label>
      <label>Lifecycle<select value={status} onChange={event => setStatus(event.target.value)}>
        <option value="open">Open</option><option value="resolved">Resolved</option><option value="all">All states</option>
      </select></label>
    </div>
    <FindingRows data={data} findings={filtered} open={open} />
  </Panel>;
}

export function Assets({ data, open }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const query = useDeferredValue(search.trim().toLowerCase());
  const filtered = data.assets.filter(asset => (!filter || filter === asset.type) &&
    matching(query, [asset.name, asset.id, asset.type, sourceName(data, asset.environment)]));
  return <Panel title="Asset inventory" icon={Box} action={<span className="panel-meta" aria-live="polite">{filtered.length} results</span>}>
    <div className="explorer-toolbar"><SearchField label="Search assets" value={search} onChange={setSearch} />
      <label>Type<select value={filter} onChange={event => setFilter(event.target.value)}>
        <option value="">All asset types</option>{Object.entries(typeNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label></div>
    <Table headers={['Resource', 'Type', 'Environment', 'Open findings', '']} empty="No assets match this view."
      rows={filtered.map(asset => {
        const id = assetKey(asset);
        const show = () => open({ type: 'asset', id });
        return { key: id, cells: [
          <button className="record-title" onClick={show}>{asset.name}<small>{asset.id}</small></button>,
          typeNames[asset.type] || asset.type, sourceName(data, asset.environment),
          data.findings.filter(f => f.environment === asset.environment && f.resourceId === asset.id).length,
          <DetailButton name={asset.name} onClick={show} />
        ] };
      })} />
  </Panel>;
}

function Definition({ entries }) {
  return <dl className="drawer-facts">{entries.map(([key, value]) =>
    <div key={key}><dt>{key}</dt><dd>{value ?? '—'}</dd></div>)}</dl>;
}

export function RecordDetails({ record, data, close }) {
  if (!record || !data) return null;
  if (record.type === 'finding') {
    const finding = data.findings.find(entry => entry.id === record.id) || data.resolved.find(entry => entry.id === record.id);
    if (!finding) return <Drawer title="Finding unavailable" subtitle="Finding details" close={close}>
      <Empty title="The latest snapshot no longer includes this record." />
    </Drawer>;
    return <Drawer title={finding.title} subtitle={finding.ruleId + ' · ' + sourceName(data, finding.environment)} close={close}>
      <div className="drawer-pills"><Pill value={finding.severity} />
        <motion.span key={lifecycle(finding)} initial={{ opacity: .55, y: 3 }} animate={{ opacity: 1, y: 0 }}>
          <Pill value={lifecycle(finding)} />
        </motion.span>
      </div>
      <Definition entries={ [['Resource', finding.resource], ['Resource ID', finding.resourceId], ['Source', sourceName(data, finding.environment)]] } />
      <section><h3>Recorded evidence</h3><pre>{finding.evidence}</pre></section>
      <section><h3>Recommendation</h3><p>{finding.recommendation}</p></section>
      <section><h3>Lifecycle</h3><ol className="drawer-timeline">
        {[['First detected', finding.detectedAt], ['Last seen', finding.lastSeenAt], ['Resolved', finding.resolvedAt]].filter(([, value]) => value)
          .map(([label, value]) => <li key={label}><strong>{label}</strong><time dateTime={value}>{time(value)}</time></li>)}
      </ol></section>
    </Drawer>;
  }
  const asset = data.assets.find(entry => assetKey(entry) === record.id);
  if (!asset) return <Drawer title="Asset unavailable" subtitle="Asset details" close={close}>
    <Empty title="The latest snapshot no longer includes this record." />
  </Drawer>;
  const { id, name, type, provider, source, environment, ...configuration } = asset;
  const matches = data.findings.filter(f => f.resourceId === id && f.environment === environment);
  return <Drawer title={name} subtitle={sourceName(data, environment)} close={close}>
    <Definition entries={ [['Resource ID', id], ['Type', typeNames[type] || type], ['Cloud provider', provider]] } />
    <section><h3>Collected configuration</h3><pre>{JSON.stringify(configuration, null, 2)}</pre></section>
    <section><h3>Open findings</h3>{matches.length ? <ul className="drawer-findings">
      {matches.map(f => <li key={f.id}><Pill value={f.severity} />{f.title}</li>)}</ul>
      : <p>No open findings for this asset.</p>}</section>
  </Drawer>;
}

export function Audit({ data, admin, api }) {
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
      rows={data.audit.map(a => ({ key: a.id, cells: [time(a.timestamp), sourceName(data, a.sourceEnvironment),
        a.decision, a.action, a.approvedBy, a.status] }))} /></Panel>
    {admin && <Panel title="Account activity" icon={Fingerprint}>{error ? <p className="feedback error inset">{error}</p>
      : security ? <Table headers={['Time', 'Event', 'Account']} rows={security.map(entry => ({
        key: entry.id, cells: [time(entry.timestamp), entry.action, entry.actor]
      }))} /> : <p className="panel-empty" role="status">Loading account activity…</p>}</Panel>}
  </>;
}
