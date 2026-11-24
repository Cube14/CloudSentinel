import React, { useDeferredValue, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Fingerprint } from 'lucide-react';
import { DetailButton, Drawer, Panel, SearchField, Table, time } from './workspace-ui';

const kinds = ['auth', 'admin', 'scan', 'lab', 'finding', 'response'];
const outcomes = ['attempted', 'started', 'success', 'failure', 'blocked', 'unsupported', 'succeeded', 'partial',
  'failed', 'not-connected', 'observed', 'SIMULATED_SUCCESS', 'REJECTED'];
const display = value => value && typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? '—');

export function SecurityAudit({ api }) {
  const { search } = useLocation();
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState(() => ({ q: new URLSearchParams(search).get('q') || '',
    operation: new URLSearchParams(search).get('operation') || '', kind: '', status: '', action: '', environment: '' }));
  const [page, setPage] = useState(1);
  const [through, setThrough] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [detail, setDetail] = useState(null);
  const query = useDeferredValue(new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString());
  const endpoint = '/api/auth/audit/events?' + query + (through === null ? '' : '&through=' + through);
  useEffect(() => {
    const controller = new AbortController();
    api(endpoint + '&page=' + page, undefined, controller.signal).then(data => {
      setResult(data);
      setError('');
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [api, endpoint, page, refresh]);

  function filter(key, value) {
    setPage(1);
    setThrough(null);
    setFilters(previous => ({ ...previous, [key]: value }));
  }

  function changePage(next) {
    setThrough(result.through);
    setPage(next);
  }

  const metrics = result?.metrics;
  const maximum = Math.max(1, ...(metrics?.failedByDay || []).map(row => row.count));
  return <Panel title="Security audit" icon={Fingerprint} action={<button type="button" className="button secondary"
    onClick={() => { setThrough(null); setPage(1); setRefresh(value => value + 1); }}>Refresh</button>}>
    {metrics && <div className="audit-overview">
      <dl className="audit-metrics">
        {[['Password attempts', metrics.attempts], ['Successful password logins', metrics.successes],
          ['Unsuccessful password attempts', metrics.failures], ['Rate-limited password attempts', metrics.blocked], ['OAuth events', metrics.oauth], ['Last sign-in', time(metrics.lastLogin)]]
          .map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      <details><summary>Failed password attempts by UTC day · last 14 days</summary>
        <div className="audit-days">{metrics.failedByDay.map(({ day, count }) => <label key={day}>
          <span>{day}</span><meter min={0} max={maximum} value={count} /> <span>{count}</span>
        </label>)}</div>
      </details>
    </div>}
    <div className="audit-fields">
      <SearchField label="Search event, account or resource" value={filters.q} onChange={value => filter('q', value)} />
      {[['kind', 'Category', kinds], ['status', 'Outcome', outcomes]].map(([key, label, options]) => <label key={key}>{label}
        <select value={filters[key]} onChange={event => filter(key, event.target.value)}>
          <option value="">All</option>{options.map(option => <option key={option}>{option}</option>)}
        </select></label>)}
      {[['action', 'Event type'], ['environment', 'Source ID'], ['operation', 'Operation ID'], ['from', 'From UTC date'], ['before', 'Before UTC date']].map(([key, label]) =>
        <label key={key}>{label}<input type={key === 'from' || key === 'before' ? 'date' : 'text'} value={filters[key] || ''} onChange={event => filter(key, event.target.value)} /></label>)}
    </div>
    {error && <p className="feedback error inset" role="alert">{error}</p>}
    {result ? <>
      <Table headers={['Time', 'Event', 'Outcome', 'Account', 'Source', 'Resource', '']} empty="No matching audit events."
        rows={result.entries.map(entry => ({ key: entry.id, cells: [time(entry.timestamp), entry.action, entry.status,
          entry.actor, entry.sourceEnvironment, entry.resource,
          <DetailButton name={entry.action} onClick={() => setDetail(entry)} />] }))} />
      <div className="audit-pagination">
        <button type="button" className="button secondary" disabled={page <= 1} onClick={() => changePage(page - 1)}>Previous</button>
        <span>Page {result.page} · {result.total} events</span>
        <button type="button" className="button secondary" disabled={page * result.pageSize >= result.total}
          onClick={() => changePage(page + 1)}>Next</button>
        <a className="button secondary" href={endpoint + '&format=csv'}>Export CSV</a>
      </div>
    </> : !error && <p className="panel-empty" role="status">Loading security audit…</p>}
    {detail && <Drawer title={detail.action} subtitle="Audit event" close={() => setDetail(null)}>
      <section><dl className="audit-event">
        {Object.entries({ 'Event ID': detail.id, 'UTC timestamp': detail.timestamp, Outcome: detail.status,
          Account: detail.actor, 'Client IP': detail.sourceIp, Channel: detail.channel, Source: detail.sourceEnvironment,
          Resource: detail.resource, 'Operation ID': detail.operationId }).map(([label, value]) =>
          <div key={label}><dt>{label}</dt><dd>{display(value)}</dd></div>)}
      </dl><h3>Details</h3><pre className="audit-evidence">{display(detail.details)}</pre></section>
    </Drawer>}
  </Panel>;
}
