'use strict';

const byId = id => document.getElementById(id);
const view = byId('view');
const selector = byId('environment');
const analyses = new Map();
const severities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const esc = value => String(value ?? '—').replace(/[&<>"']/g,
  char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const formatTime = value => value ? new Date(value).toLocaleString() : '—';
const evidenceKey = incident => JSON.stringify(incident.events);
const pill = value => '<span class="pill ' + esc(value) + '">' + esc(value) + '</span>';
const cell = value => '<td>' + esc(value) + '</td>';
const row = (...values) => '<tr>' + values.map(cell).join('') + '</tr>';
const panel = (title, content) => '<section class="panel"><h2>' + title + '</h2>' + content + '</section>';
let tab = 'dashboard';
let data;
let revision = 0;
let rendered = '';
let manualScan = false;

function scope(path, environment = selector.value) {
  return environment ? path + '?environment=' + encodeURIComponent(environment) : path;
}

async function api(path, body, signal) {
  const options = body === undefined ? { signal } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  };
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || response.status);
  return result;
}

function showError(message) {
  byId('error').hidden = !message;
  byId('error').textContent = message || '';
}

function table(columns, rows) {
  return '<table><thead><tr>' + columns.map(column => '<th scope="col">' + column + '</th>').join('') +
    '</tr></thead><tbody>' + (rows.join('') || '<tr><td colspan="' + columns.length +
      '">No records</td></tr>') + '</tbody></table>';
}

function findingsTable(findings, resolved = false) {
  return table(['Severity', 'Finding', 'Environment', 'Resource', 'Evidence', 'Recommendation',
    resolved ? 'Resolved' : 'First detected'], findings.map(f =>
    '<tr><td>' + pill(f.severity) + '</td><td>' + esc(f.title) + '<br><span class="muted">' +
    esc(f.ruleId) + '</span></td>' + cell(f.environment) + cell(f.resource) + cell(f.evidence) +
    cell(f.recommendation) + cell(formatTime(resolved ? f.resolvedAt : f.detectedAt)) + '</tr>'));
}

function overview() {
  const { summary, findings, history } = data;
  const metrics = [
    ['Posture score', summary.score === null ? '—' : summary.score + ' / 100'],
    ['Monitored assets', summary.assets], ['Open findings', summary.findings], ['Critical findings', summary.critical]
  ];
  const cards = '<div class="metrics">' + metrics.map(([label, value]) =>
    '<div class="metric"><span>' + label + '</span><strong>' + esc(value) + '</strong></div>').join('') + '</div>';
  const scans = table(['Environment', 'Source', 'Status', 'Last successful scan', 'Findings'],
    summary.providers.map(source => '<tr>' + cell(source.label) + cell(source.kind) +
      '<td>' + pill(source.status) + (source.error ? '<p class="scan-error">' + esc(source.error) + '</p>' : '') +
      '</td>' + cell(formatTime(source.lastSuccess)) + cell(source.findings) + '</tr>'));
  const chart = summary.findings === null ? '<p class="muted">Awaiting the first successful scan.</p>' :
    '<ul class="severity-chart">' + severities.map(severity => {
      const count = findings.filter(finding => finding.severity === severity).length;
      return '<li>' + pill(severity) + '<progress class="' + severity + '" value="' + count +
        '" max="' + Math.max(findings.length, 1) + '" aria-label="' + severity + ' findings"></progress><b>' + count + '</b></li>';
    }).join('') + '</ul>';
  const timeline = table(['Finished', 'Environment', 'Result', 'Findings'], history.slice(0, 12).map(run =>
    row(formatTime(run.finishedAt), run.environment, run.error || run.status, run.findings)));
  return cards + '<div class="grid">' + panel('Environment health', scans) + panel('Finding severity', chart) +
    '</div>' + panel('High-priority findings', findingsTable(findings.filter(f =>
      ['CRITICAL', 'HIGH'].includes(f.severity)).sort((a, b) => severities.indexOf(a.severity) -
        severities.indexOf(b.severity)).slice(0, 6))) + panel('Scan timeline', timeline);
}

function incidentsView() {
  const emulator = data.summary.providers.length === 1 && data.summary.providers[0].kind === 'emulator';
  const replay = emulator ? '<p class="muted">Event collection is unavailable for this emulator source.</p>' :
    '<div class="controls"><button id="simulate">Replay fixture event scenario</button></div>';
  return replay + (data.incidents.length ? data.incidents.map(incident => {
    const id = esc(incident.id);
    const evidence = table(['Time', 'API action', 'Target', 'Source'], incident.events.map(event =>
      row(formatTime(event.timestamp), event.action, event.resource, event.source)));
    const analysis = analyses.get(incident.id);
    return '<article class="panel"><div class="row"><h2>' + esc(incident.actor) + ' · ' +
      esc(incident.environment) + '</h2>' + pill(incident.severity) + '</div><p class="muted">' +
      esc(incident.summary) + ' · ' + esc(incident.ruleIds.join(', ')) + '</p><p class="chain">' +
      incident.attackStages.map(esc).join(' → ') + '</p>' + evidence +
      '<div class="controls"><button data-investigate="' + id + '">Investigate incident</button>' +
      '<select aria-label="Simulated response" id="action-' + id + '">' +
      '<option value="DISABLE_ACCESS_KEY">Disable access key</option><option value="REMOVE_POLICY">Remove policy</option>' +
      '<option value="QUARANTINE_INSTANCE">Quarantine instance</option></select>' +
      '<button data-respond="' + id + '">Approve simulated response</button></div>' +
      '<div id="analysis-' + id + '" aria-live="polite">' +
      analysisMarkup(analysis?.evidence === evidenceKey(incident) ? analysis.value : null) + '</div></article>';
  }).join('') : panel('Incidents', '<p class="muted">No incidents in this environment.</p>'));
}

function analysisMarkup(analysis) {
  if (!analysis) return '';
  if (typeof analysis === 'string') return '<p class="muted">' + esc(analysis) + '</p>';
  const items = values => '<ul>' + values.map(value => '<li>' + esc(value) + '</li>').join('') + '</ul>';
  return '<h3>Investigation · ' + esc(analysis.mode) + '</h3><p>' + esc(analysis.summary) + '</p>' +
    '<h4>Recorded evidence</h4>' + items(analysis.observations) + '<h4>Hypotheses to verify</h4>' +
    items(analysis.hypotheses) + '<h4>Suggested verification steps</h4>' + items(analysis.recommendations) +
    (analysis.warning ? '<p class="muted">' + esc(analysis.warning) + '</p>' : '');
}

function render() {
  const titles = { dashboard: 'Security Overview', findings: 'Security Findings', assets: 'Cloud Asset Inventory',
    iam: 'Identity & Access Risks', incidents: 'Threat Detection & Attack Chains', audit: 'Response Audit Trail' };
  byId('pageTitle').textContent = titles[tab];
  for (const button of document.querySelectorAll('[data-tab]')) {
    const active = button.dataset.tab === tab;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  if (!data) {
    rendered = '';
    view.textContent = 'Loading environment…';
    return;
  }
  const { summary, findings, resolved, assets, audit } = data;
  const sources = summary.providers;
  const failed = sources.filter(source => source.status === 'failed');
  byId('notice').textContent = (sources.length === 1
    ? sources[0].label + (sources[0].kind === 'fixture' ? ' · simulated configurations' : ' · local emulator')
    : 'AWS, Azure and GCP fixtures' + (sources.some(source => source.kind === 'emulator') ? ' and local AWS Floci emulator' : '')) +
    (failed.length ? ' · Scan failed for ' + failed.map(source => source.label + ' (' + source.error + ')').join(', ') +
      '. Available counts reflect the last successful snapshots.' : '');
  const active = sources.filter(source => ['queued', 'running'].includes(source.status));
  byId('updated').textContent = (active.length ? 'Scanning ' + active.map(source => source.label).join(', ') + ' · ' : '') +
    'Last successful scan: ' + formatTime(summary.lastScan);
  byId('cadence').textContent = 'Scheduled scan interval: ' + data.intervalMs / 1000 + ' seconds';
  byId('scan').disabled = manualScan;

  const views = {
    dashboard: overview,
    findings: () => panel('Open findings', findingsTable(findings)) + panel('Resolved findings', findingsTable(resolved, true)),
    assets: () => panel('Normalized inventory', table(['Cloud', 'Environment', 'Resource', 'Type', 'Configuration'],
      assets.map(({ id, provider, environment, name, type, source, ...configuration }) =>
        '<tr>' + cell(provider.toUpperCase()) + cell(environment) + cell(name) + cell(type) +
        '<td><pre>' + esc(JSON.stringify(configuration, null, 2)) + '</pre></td></tr>'))),
    iam: () => panel('Identity findings', findingsTable(findings.filter(f =>
      f.ruleId.startsWith('IAM-') || ['CSPM-006', 'CSPM-007'].includes(f.ruleId)))),
    incidents: incidentsView,
    audit: () => panel('Simulated responses', table(['Time', 'Environment', 'Incident', 'Decision', 'Action', 'Approver', 'Result'],
      audit.map(a => row(formatTime(a.timestamp), a.sourceEnvironment, a.incidentId,
        a.decision, a.action, a.approvedBy, a.status))))
  };
  const html = views[tab]();
  if (html !== rendered) {
    view.innerHTML = html;
    rendered = html;
  }
}

let pollController;
async function refresh() {
  const id = ++revision;
  pollController?.abort();
  pollController = new AbortController();
  try {
    const signal = AbortSignal.any([pollController.signal, AbortSignal.timeout(7000)]);
    const next = await api(scope('/api/dashboard'), undefined, signal);
    if (id !== revision) return;
    data = next;
    const current = selector.value;
    const options = '<option value="">All configured environments</option>' + next.environments.map(source =>
      '<option value="' + esc(source.id) + '">' + esc(source.label) + '</option>').join('');
    if (selector.dataset.options !== options) {
      selector.innerHTML = options;
      selector.dataset.options = options;
      selector.value = current;
    }
    if (byId('error').dataset.source === 'refresh') showError();
    render();
  } catch (error) {
    if (id === revision) {
      showError('Dashboard refresh failed: ' + error.message);
      byId('error').dataset.source = 'refresh';
    }
  }
}

function actionError(error) {
  byId('error').dataset.source = 'action';
  showError(error.message);
}

document.querySelector('nav').addEventListener('click', event => {
  if (!event.target.dataset.tab) return;
  tab = event.target.dataset.tab;
  render();
});
selector.addEventListener('change', () => {
  showError();
  data = null;
  byId('updated').textContent = '';
  byId('notice').textContent = '';
  render();
  refresh();
});
byId('scan').addEventListener('click', async () => {
  manualScan = true;
  byId('scan').disabled = true;
  showError();
  const environment = selector.value;
  try {
    await api(scope('/api/scans/run', environment), {});
  } catch (error) {
    if (selector.value === environment) actionError(error);
  } finally {
    manualScan = false;
    byId('scan').disabled = false;
    await refresh();
  }
});
view.addEventListener('click', async event => {
  const { investigate, respond } = event.target.dataset;
  showError();
  try {
    if (event.target.id === 'simulate') {
      await api('/api/simulations/run', {});
      analyses.clear();
      await refresh();
    }
    if (investigate) {
      const incident = data.incidents.find(entry => entry.id === investigate);
      const evidence = evidenceKey(incident);
      const existing = analyses.get(investigate);
      if (existing?.evidence === evidence && existing.value === 'Running investigation…') return;
      const path = scope('/api/incidents/' + investigate + '/investigate');
      const entry = { evidence, value: 'Running investigation…' };
      analyses.set(investigate, entry);
      render();
      try {
        entry.value = await api(path, {});
      } catch (error) {
        if (analyses.get(investigate) === entry) analyses.delete(investigate);
        throw error;
      } finally {
        render();
      }
    }
    if (respond) {
      const action = byId('action-' + respond).value;
      const approvedBy = prompt('Approving analyst name for the simulated response');
      if (!approvedBy || !confirm('Record simulated response ' + action + '?')) return;
      await api(scope('/api/incidents/' + respond + '/respond'), { decision: 'approve', action, approvedBy });
      tab = 'audit';
      await refresh();
    }
  } catch (error) {
    actionError(error);
  }
});

async function poll() {
  await refresh();
  setTimeout(poll, 2000);
}
poll();
