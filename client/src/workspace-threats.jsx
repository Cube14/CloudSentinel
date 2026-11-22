import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Activity, Bot, CircleAlert, Fingerprint, Radar, RotateCcw, ScanLine } from 'lucide-react';
import { Empty, Panel, Pill, scope, sourceName, shortTime, time } from './workspace-ui';

const actions = [['DISABLE_ACCESS_KEY', 'Disable access key'], ['REMOVE_POLICY', 'Remove policy'],
  ['QUARANTINE_INSTANCE', 'Quarantine instance']];

function useAnalyst(api, enabled) {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer;
    async function check() {
      try {
        const result = await api('/api/ollama/status', undefined, controller.signal);
        if (!controller.signal.aborted) setStatus(result);
      } catch {
        if (!controller.signal.aborted) setStatus({ state: 'unknown' });
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(check, 20000);
      }
    }
    check();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [api, enabled]);
  return status;
}

function Analyst({ status, report, working, disabled, run, admin }) {
  const state = status?.state || 'checking';
  const stateLabel = { checking: 'Checking Ollama', ready: 'Model available', 'model-missing': 'Model unavailable',
    offline: 'Ollama unreachable', unknown: 'Status unavailable' }[state];
  return <Panel icon={Bot} title="AI analyst" className="analyst-sheet"
    action={<Pill value={state === 'ready' ? 'succeeded' : 'idle'}>{stateLabel}</Pill>}>
    <div className="analyst-body">
      <p className="analyst-model"><Bot size={22} strokeWidth={1.5} /><span><strong>{status?.model || 'Local Ollama'}</strong>
        <small>Investigation grounded in recorded incident events</small></span></p>
      {admin ? <button className="button primary full" onClick={run} disabled={disabled}>
        <ScanLine size={17} className={working ? 'scanning-icon' : ''} />{working ? 'Investigating…' : 'Investigate incident'}</button>
        : <p className="panel-empty">An administrator can run an investigation.</p>}
      {working && <div className="analyst-loading" role="status"><span className="loading-line" />Reviewing recorded evidence…</div>}
      {!report && !working && admin && <p className="analyst-note">A rule-based report is available if the model cannot respond.</p>}
      {report && <motion.div className="analyst-report" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}>
        <Pill value={report.mode}>{report.mode === 'ollama' ? 'Local Ollama' : 'Rule-based fallback'}</Pill>
        <p>{report.summary}</p>
        {[['Recorded evidence', report.observations], ['Hypotheses to verify', report.hypotheses],
          ['Verification steps', report.recommendations]].map(([title, values]) => <section key={title}>
          <h3>{title}</h3><ul>{values.map((value, index) => <li key={index}>{value}</li>)}</ul>
        </section>)}
        {report.warning && <p className="analyst-note">{report.warning}</p>}
      </motion.div>}
    </div>
  </Panel>;
}

function Incident({ incident, source, admin, api, environment, update, analyst }) {
  const [selected, setSelected] = useState(0);
  const [report, setReport] = useState(null);
  const [proposed, setProposed] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const event = incident.events[selected];
  const base = '/api/incidents/' + incident.id;

  async function investigate() {
    setBusy('investigate');
    setError('');
    try { setReport(await api(scope(base + '/investigate', environment), {})); }
    catch (error) { setError(error.message); }
    finally { setBusy(''); }
  }
  async function respond(decision) {
    setBusy('respond');
    setError('');
    try {
      const result = await api(scope(base + '/respond', environment), { action: proposed, decision });
      setConfirmation(result.status === 'REJECTED' ? 'Rejection recorded in the audit trail.' : 'Simulated approval recorded in the audit trail.');
      setProposed('');
      update();
    } catch (error) { setError(error.message); }
    finally { setBusy(''); }
  }

  return <article className="incident-workspace">
    <div className="incident-heading">
      <div><p className="eyebrow"><Radar size={15} /> {source}</p><h2>{incident.actor}</h2><p>{incident.summary}</p></div>
      <div className="incident-identity"><Pill value={incident.severity} /><code>{incident.id}</code></div>
    </div>
    {(error || confirmation) && <p className={'feedback' + (error ? ' error' : '')} role={error ? 'alert' : 'status'}>
      {error && <CircleAlert size={17} />}{error || confirmation}</p>}
    <div className="incident-grid">
      <div className="incident-evidence">
        <Panel icon={Activity} title="Attack chain" action={<span className="panel-meta">{incident.ruleIds.join(' · ')}</span>}>
          <ol className="attack-stages">{incident.attackStages.map((stage, index) =>
            <motion.li key={stage} initial={{ opacity: .35, y: 7 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: .28, delay: index * .055 }}><span><ScanLine size={18} strokeWidth={1.55} /></span>{stage}</motion.li>
          )}</ol>
        </Panel>
        <Panel icon={Fingerprint} title="Event evidence" action={<span className="panel-meta">{incident.events.length} events</span>}>
          <div className="event-review">
            <ol className="event-list">{incident.events.map((item, index) => <li key={item.eventId || index}><button type="button"
              aria-pressed={selected === index} onClick={() => setSelected(index)}>
              <time dateTime={item.timestamp}>{shortTime(item.timestamp)}</time><span>{item.action}</span>
            </button></li>)}</ol>
            {event && <motion.dl className="event-detail" key={selected} initial={{ opacity: .6 }} animate={{ opacity: 1 }}>
              {[['Timestamp', time(event.timestamp)], ['Actor', event.actor], ['Target', event.resource],
                ['Source', event.source], ['Source IP', event.sourceIp]].filter(([, value]) => value).map(([key, value]) =>
                <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}
            </motion.dl>}
          </div>
        </Panel>
        {admin && <Panel icon={ScanLine} title="Simulated response">
          <div className="response-controls"><label className="sr-only" htmlFor={'action-' + incident.id}>Simulated action</label>
            <select id={'action-' + incident.id} value={proposed} onChange={event => { setProposed(event.target.value); setConfirmation(''); }}>
              <option value="">Select an action</option>{actions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            {proposed && <><button className="button primary small" disabled={!!busy} onClick={() => respond('approve')}>Approve simulation</button>
              <button className="button secondary small" disabled={!!busy} onClick={() => respond('reject')}>Record rejection</button></>}
          </div>
        </Panel>}
      </div>
      <Analyst status={analyst} report={report} working={busy === 'investigate'} disabled={!!busy} run={investigate} admin={admin} />
    </div>
  </article>;
}

export function Threats({ data, admin, api, environment, update, reportError }) {
  const [replaying, setReplaying] = useState(false);
  const emulator = data.summary.providers.length === 1 && data.summary.providers[0].kind === 'emulator';
  const analyst = useAnalyst(api, !emulator && data.incidents.length > 0);
  async function replay() {
    setReplaying(true);
    try { await api('/api/simulations/run', {}); update(); }
    catch (error) { reportError(error.message); }
    finally { setReplaying(false); }
  }
  if (emulator) return <Panel title="Incident evidence" icon={Radar}><Empty title="Event collection is unavailable for Floci."
    >Select a fixture environment to inspect recorded lab events.</Empty></Panel>;
  return <>
    {admin && <button className="button secondary replay" onClick={replay} disabled={replaying}>
      <RotateCcw size={16} />{replaying ? 'Replaying…' : 'Replay fixture events'}</button>}
    {data.incidents.length ? data.incidents.map(incident => <Incident key={incident.id + JSON.stringify(incident.events)}
      source={sourceName(data, incident.environment)} {...{ incident, admin, api, environment, update, analyst }} />)
      : <Panel title="Incident evidence" icon={Radar}><Empty title="No incidents in this environment." /></Panel>}
  </>;
}
