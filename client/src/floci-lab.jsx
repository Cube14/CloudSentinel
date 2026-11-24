import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Database, ShieldCheck } from 'lucide-react';
import { Empty, Panel, Pill, time } from './workspace-ui';

const route = '/api/lab/s3';
const audit = '/workspace/audit?q=';
const blank = { policy: 'private', block: true, encryption: 'AES256' };
const values = config => {
  const unavailable = (setting, label) => setting.supported ? label : 'Unsupported by Floci';
  return [
    ['Policy', unavailable(config.policy, config.policy.value === true ? 'Public policy' :
      config.policy.value === false ? 'Non-public policy' : 'No bucket policy')],
    ['Block Public Access', unavailable(config.block, config.block.value
      ? Object.entries(config.block.value).map(([key, value]) => key + ' ' + (value ? 'on' : 'off')).join(' · ')
      : 'No bucket-level configuration')],
    ['Explicit encryption', unavailable(config.encryption, config.encryption.value?.join(', ') ?? 'No explicit configuration')]
  ];
};

function Configuration({ data }) {
  return <dl className="audit-event">{values(data).map(([label, value]) =>
    <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

export function FlociLab({ api, onScan }) {
  const [list, setList] = useState(null);
  const [selected, setSelected] = useState('');
  const [inspection, setInspection] = useState(null);
  const [operation, setOperation] = useState(null);
  const [findings, setFindings] = useState([]);
  const [scanStatus, setScanStatus] = useState('');
  const [prefix, setPrefix] = useState('');
  const [template, setTemplate] = useState('secure');
  const [confirm, setConfirm] = useState('');
  const [custom, setCustom] = useState(blank);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const active = useRef(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api(route, undefined, controller.signal).then(setList)
      .catch(error => { if (!controller.signal.aborted) { setList(null); setError(error.message); } });
    return () => controller.abort();
  }, [api, version]);

  useEffect(() => {
    const controller = new AbortController();
    if (selected) api(route + '?bucket=' + encodeURIComponent(selected), undefined, controller.signal)
      .then(setInspection).catch(error => {
        if (!controller.signal.aborted) {
          setInspection(null);
          if (error.status === 404) select('');
          setError(error.message);
        }
      });
    api('/api/dashboard?environment=aws-floci', undefined, controller.signal).then(data => {
      setFindings([...data.findings, ...data.resolved]);
    }).catch(() => {});
    return () => controller.abort();
  }, [api, selected, version]);

  function select(name) {
    setInspection(null);
    setOperation(null);
    setConfirm('');
    setSelected(name);
  }

  async function apply(event) {
    event.preventDefault();
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError('');
    setOperation(null);
    try {
      const result = await api(route, { ...(selected ? { bucket: selected } : { prefix }), confirm, template,
        ...(template === 'custom' ? { custom } : {}) });
      setSelected(result.name);
      setInspection(result.after);
      setOperation(result);
      setConfirm('');
    } catch (error) { setError(error.message); }
    finally { active.current = false; setBusy(false); setVersion(value => value + 1); }
  }

  async function scan() {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError('');
    setScanStatus('Scanning…');
    try {
      const result = await api(route + '/scan', {});
      setFindings([...result.findings, ...result.resolved]);
      setScanStatus(result.status === 'succeeded' ? 'Complete scan' : 'Partial scan. Previously open findings were preserved.');
      onScan();
    } catch (error) { setError(error.message); setScanStatus('Scan failed'); }
    finally { active.current = false; setBusy(false); setVersion(value => value + 1); }
  }

  const existing = inspection?.name === selected ? inspection : null;
  const visibleFindings = findings.filter(finding => finding.resourceId === selected && finding.ruleId === 'S3-001');
  return <>
    <Panel title="Floci S3 Lab" icon={Database} action={<button className="button secondary" type="button" disabled={busy}
      onClick={() => { setError(''); setVersion(value => value + 1); }}>Refresh</button>}>
      {error && <p className="feedback error inset" role="alert">{error}</p>}
      {list && <>
        <p className="lab-description">Floci {list.version} · verified on 127.0.0.1:4566. Use empty, disposable buckets.</p>
        <form className="lab-form" onSubmit={apply}>
          <label>Bucket<select aria-label="Bucket" value={selected} disabled={busy} onChange={event => select(event.target.value)}>
            <option value="">Create a demo bucket</option>
            {list.buckets.map(bucket => <option key={bucket.name} value={bucket.name}>{bucket.name}</option>)}
          </select></label>
          {!selected && <label>Name prefix<input value={prefix} onChange={event => setPrefix(event.target.value)}
            minLength={2} maxLength={24} pattern="[a-z0-9][a-z0-9\x2d]*[a-z0-9]" required disabled={busy} /></label>}
          {existing && <><Configuration data={existing} />
            {!existing.managed && <p>Inspection only. This bucket has no current disposable lab approval.</p>}</>}
          {(!selected || existing?.managed) && <>
            <label>Template<select aria-label="Template" value={template} onChange={event => setTemplate(event.target.value)} disabled={busy}>
              <option value="secure">Secure private bucket</option>
              <option value="public">Public-policy demo bucket</option>
              <option value="custom">Custom lab configuration</option>
            </select></label>
            {template === 'custom' && <div className="audit-fields lab-options">
              <label>Policy<select value={custom.policy} onChange={event => setCustom({ ...custom, policy: event.target.value,
                block: event.target.value === 'public' ? false : custom.block })} disabled={busy}>
                <option value="private">Remove bucket policy</option><option value="public">Public object-read policy</option>
              </select></label>
              <label>Block Public Access<select value={String(custom.block)} disabled={busy || custom.policy === 'public'}
                onChange={event => setCustom({ ...custom, block: event.target.value === 'true' })}>
                <option value="true">Enable all four</option><option value="false">Disable all four</option>
              </select></label>
              <label>Encryption<select value={custom.encryption} onChange={event => setCustom({ ...custom, encryption: event.target.value })}
                disabled={busy}><option value="AES256">Set AES256</option><option value="leave">Keep current setting</option></select></label>
            </div>}
            <label>Type the exact {selected ? 'bucket name' : 'prefix'} to confirm
              <input value={confirm} onChange={event => setConfirm(event.target.value)} disabled={busy} required />
            </label>
            <button className="button primary" disabled={busy || !confirm || confirm !== (selected || prefix)}>
              {selected ? (template === 'secure' ? 'Remediate bucket' : 'Apply configuration') : 'Create bucket'}
            </button>
          </>}
        </form>
      </>}
      {operation && <section className="lab-description" aria-live="polite">
        <h3>Verified configuration change</h3>
        <div className="lab-evidence"><div><h4>Before</h4><Configuration data={operation.before} /></div>
          <div><h4>After</h4><Configuration data={operation.after} /></div></div>
        {operation.warnings.map(warning => <p className="feedback warning" key={warning}>{warning}</p>)}
        <Link to={'/workspace/audit?operation=' + encodeURIComponent(operation.operationId)}>View operation audit events</Link>
      </section>}
    </Panel>
    <Panel title="S3 public-policy findings" icon={ShieldCheck} action={<button type="button" className="button secondary"
      onClick={scan} disabled={busy || !list}>Run complete scan</button>}>
      {scanStatus && <p className="lab-description" role="status">{scanStatus}</p>}
      {visibleFindings.length ? visibleFindings.map(finding => <section className="lab-description" key={finding.id}>
        <h3>{finding.ruleId} · {finding.title} <Pill value={finding.status} /></h3>
        <p>{finding.severity} · <code>{finding.id}</code></p>
        <p>{finding.evidence}</p>
        {finding.resolutionEvidence && <p>{finding.resolutionEvidence} · {time(finding.resolvedAt)}</p>}
        <p>{finding.recommendation}</p>
        <Link to={audit + encodeURIComponent(finding.id)}>View finding timeline</Link>
      </section>) : <Empty title={selected ? 'No recorded public-policy finding for this bucket.' : 'Select a bucket to see its findings.'} />}
      {selected && <p className="lab-description"><Link to={audit + encodeURIComponent(selected)}>View bucket timeline</Link></p>}
    </Panel>
  </>;
}
