'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { detect } = require('../security-engine/engine');
const { createScanner, fixtureSources, providers } = require('./scans');
const { flociSource } = require('./floci');
const { loadConnectors } = require('./connectors/config');
const { investigate, ollamaStatus } = require('./investigation');
const { createAuth } = require('./auth');
const { databasePath, openStore } = require('./auth/store');
const { localEndpoint } = require('./local-endpoint');

const root = path.resolve(__dirname, '..');
const clientDir = path.join(root, 'client', 'dist');
const safe = value => typeof value === 'string' && value.trim().length > 0 && value.length < 128;
const assetTypes = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.txt': 'text/plain' };

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function parse(req, limit = 1000000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) {
      req.resume();
      throw Object.assign(new Error('Request body too large'), { status: 413 });
    }
    chunks.push(chunk);
  }
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SyntaxError('Expected a JSON object');
  return body;
}

async function serveClient(res, pathname) {
  const asset = pathname === '/mark.svg' || /^\/assets\/[a-zA-Z0-9_.-]+$/.test(pathname);
  const page = pathname === '/' || pathname === '/login' || pathname === '/signup' ||
    pathname === '/workspace' || pathname.startsWith('/workspace/');
  if (!asset && !page) return json(res, 404, { error: 'Not found' });
  const filename = asset ? path.join(clientDir, pathname.slice(1)) : path.join(clientDir, 'index.html');
  const type = assetTypes[path.extname(filename)];
  if (!type) return json(res, 404, { error: 'Not found' });
  try {
    const body = await fs.readFile(filename);
    res.writeHead(200, { 'Content-Type': type.startsWith('font/') ? type : type + '; charset=utf-8',
      'Cache-Control': asset && !pathname.endsWith('.txt') && pathname !== '/mark.svg'
        ? 'public, max-age=31536000, immutable' : 'no-cache' });
    return res.end(body);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return asset ? json(res, 404, { error: 'Not found' })
      : json(res, 503, { error: 'Build the local React client with npm run build.' });
  }
}

function createApp({ env = process.env, fixtureDir = path.join(root, 'fixtures'), sources,
  dbPath = databasePath(env), oidcFetch } = {}) {
  const intervalMs = Number(env.SCAN_INTERVAL_MS ?? 15000);
  if (!Number.isInteger(intervalMs) || intervalMs < 1000 || intervalMs > 2147483647) {
    throw new Error('SCAN_INTERVAL_MS must be an integer from 1000 to 2147483647');
  }
  const configuredSources = sources ?? fixtureSources(fixtureDir);
  if (!sources) {
    if (env.FLOCI_ENDPOINT) configuredSources.push(flociSource(env.FLOCI_ENDPOINT));
    configuredSources.push(...loadConnectors(env.CLOUD_SOURCES_FILE, root, configuredSources.map(source => source.id)));
  }
  const scanner = createScanner(configuredSources);
  const devOrigin = env.CLIENT_DEV_ORIGIN ? localEndpoint(env.CLIENT_DEV_ORIGIN) : null;
  const store = openStore(dbPath);
  let auth;
  try {
    auth = createAuth({ store, env, json, parse, oidcFetch });
  } catch (error) {
    store.close();
    throw error;
  }
  let events = [], incidents = [];
  let initial = Promise.resolve();
  let timer;
  let pruning;

  async function loadEvents() {
    const raw = await fs.readFile(path.join(fixtureDir, 'events.json'), 'utf8');
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
    if (!Array.isArray(parsed)) throw new Error('Invalid event fixture');
    const newEvents = parsed.map(event => ({ ...event, source: 'fixture' }));
    const newIncidents = detect(newEvents);
    events = newEvents;
    incidents = newIncidents;
  }

  function dashboard(id) {
    const selected = scanner.selected(id);
    const environments = selected.map(scanner.describe);
    const results = selected.flatMap(entry => entry.result ? [entry.result] : []);
    const findings = results.flatMap(result => result.findings);
    const scores = results.flatMap(result => result.score === null ? [] : [result.score]);
    const scoped = entries => id === null ? entries : entries.filter(entry => entry.environment === id);
    const currentIncidents = scoped(incidents);
    const completed = environments.filter(environment => environment.lastSuccess);
    const summary = {
      lastScan: completed.map(environment => environment.lastSuccess).sort().at(-1) ?? null,
      providers: environments,
      assets: results.length ? results.reduce((total, result) => total + result.assets, 0) : null,
      findings: results.length ? findings.length : null,
      critical: results.length ? findings.filter(finding => finding.severity === 'CRITICAL').length : null,
      score: scores.length && !environments.some(source => source.coverage === 'partial')
        ? Math.round(scores.reduce((total, score) => total + score, 0) / scores.length) : null,
      incidents: currentIncidents.length
    };
    return {
      summary, intervalMs, environments: scanner.selected(null).map(scanner.describe),
      assets: selected.flatMap(entry => entry.inventory), findings,
      resolved: selected.flatMap(entry => entry.resolved),
      history: selected.flatMap(entry => entry.history.map(run => ({ ...run, environment: entry.source.id })))
        .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt)),
      incidents: currentIncidents, events: scoped(events),
      audit: store.audit(id)
    };
  }

  const app = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const port = app.address().port;
      const hosts = ['localhost:' + port, '127.0.0.1:' + port];
      if (port === 80) hosts.push('localhost', '127.0.0.1');
      if (!hosts.includes(req.headers.host)) return json(res, 403, { error: 'Expected a local request' });
      const origin = new URL('http://' + req.headers.host).origin;
      if (req.method !== 'GET' && req.headers.origin &&
          req.headers.origin !== origin && req.headers.origin !== devOrigin) {
        return json(res, 403, { error: 'Expected a local request from this origin' });
      }
      const url = new URL(req.url, origin);
      const { pathname } = url;
      if (url.origin !== origin) return json(res, 400, { error: 'Invalid local request URL' });
      if (!pathname.startsWith('/api/')) {
        return req.method === 'GET' ? await serveClient(res, pathname) : json(res, 404, { error: 'Not found' });
      }
      if (req.method === 'GET' && pathname === '/api/health') {
        const mode = configuredSources.some(source => source.kind !== 'fixture' && source.collect) ? 'local-mixed' : 'local-simulation';
        return json(res, 200, { status: 'ok', mode, providers, intervalMs });
      }
      const user = auth.authenticate(req);
      if (pathname.startsWith('/api/auth/')) return await auth.handle(req, res, url, user);
      if (!user) return json(res, 401, { error: 'Sign in required.' });
      if (req.method === 'GET' && pathname === '/api/ollama/status') return json(res, 200, await ollamaStatus(env));
      if (req.method === 'POST') {
        if (user.role !== 'admin') return json(res, 403, { error: 'Administrator access required.' });
        auth.checkCsrf(req, user);
      }
      const id = url.searchParams.get('environment');
      if (id !== null && !scanner.has(id)) return json(res, 404, { error: 'Unknown environment' });
      await initial;
      if (req.method === 'GET') {
        const data = dashboard(id);
        switch (pathname) {
          case '/api/environments': return json(res, 200, data.environments);
          case '/api/dashboard': return json(res, 200, data);
          case '/api/dashboard/summary': return json(res, 200, data.summary);
          case '/api/assets': return json(res, 200, data.assets);
          case '/api/findings': return json(res, 200, data.findings);
          case '/api/findings/resolved': return json(res, 200, data.resolved);
          case '/api/scans/latest':
            return json(res, 200, Object.fromEntries(scanner.selected(id).map(entry => [
              entry.source.kind === 'fixture' ? entry.source.provider : entry.source.id,
              { ...scanner.describe(entry), ...entry.result }
            ])));
          case '/api/iam':
            return json(res, 200, data.findings.filter(f => f.ruleId.startsWith('IAM-') ||
              ['CSPM-006', 'CSPM-007'].includes(f.ruleId)));
          case '/api/incidents': return json(res, 200, data.incidents);
          case '/api/events': return json(res, 200, data.events);
          case '/api/audit': return json(res, 200, data.audit);
          default: return json(res, 404, { error: 'Not found' });
        }
      }

      if (req.method !== 'POST') return json(res, 404, { error: 'Not found' });
      if (pathname === '/api/scans/run') {
        await scanner.run(id);
        const { summary } = dashboard(id);
        if (id !== null && summary.providers[0].status === 'not-connected') {
          return json(res, 409, { ...summary, error: summary.providers[0].error || 'Source not connected' });
        }
        const failed = summary.providers.filter(source => source.status === 'failed');
        return failed.length
          ? json(res, 503, { ...summary, error: failed.map(source => source.label + ': ' + source.error).join(' | ') })
          : json(res, 200, summary);
      }
      if (pathname === '/api/events') {
        const body = await parse(req);
        const environment = body.environment ?? body.provider + '-lab';
        const { actor, action, provider, timestamp, resource, sourceIp, bytes, sensitive } = body;
        if (!safe(actor) || !safe(action) || !providers.includes(provider) ||
            typeof body.timestamp !== 'string' || !Number.isFinite(Date.parse(body.timestamp)) ||
            (resource !== undefined && !safe(resource)) || (sourceIp !== undefined && !safe(sourceIp)) ||
            (bytes !== undefined && (!Number.isSafeInteger(bytes) || bytes < 0)) ||
            (sensitive !== undefined && typeof sensitive !== 'boolean') ||
            !configuredSources.some(source => source.kind === 'fixture' && source.id === environment &&
              source.provider === body.provider) || (id !== null && id !== environment)) {
          return json(res, 400, { error: 'Invalid fixture event' });
        }
        const event = { actor, action, provider, timestamp, resource, sourceIp, bytes, sensitive,
          environment, eventId: 'EVT-' + randomUUID(), source: 'manual' };
        events.push(event);
        incidents = detect(events);
        return json(res, 201, { event, incidents: dashboard(id).incidents });
      }
      if (pathname === '/api/simulations/run') {
        await loadEvents();
        return json(res, 200, { events: events.length, incidents });
      }
      const match = pathname.match(/^\/api\/incidents\/([^/]+)\/(investigate|respond)$/);
      if (!match) return json(res, 404, { error: 'Not found' });
      const incident = incidents.find(entry => entry.id === match[1] && (id === null || id === entry.environment));
      if (!incident) return json(res, 404, { error: 'Unknown incident' });
      if (match[2] === 'investigate') return json(res, 200, await investigate(incident, env));
      const body = await parse(req);
      if (!['approve', 'reject'].includes(body.decision) ||
          !['DISABLE_ACCESS_KEY', 'REMOVE_POLICY', 'QUARANTINE_INSTANCE'].includes(body.action)) {
        return json(res, 400, { error: 'Invalid response request' });
      }
      const log = {
        id: 'AUD-' + randomUUID(), incidentId: incident.id, decision: body.decision,
        action: body.action, approvedBy: user.email, environment: 'simulation',
        sourceEnvironment: incident.environment, status: body.decision === 'approve' ? 'SIMULATED_SUCCESS' : 'REJECTED',
        timestamp: new Date().toISOString()
      };
      store.addAudit('response', log);
      return json(res, 201, log);
    } catch (error) {
      const status = error.status || (error instanceof SyntaxError ? 400 : 500);
      if (status === 500) console.error('Request failed:', error.message);
      return json(res, status, { error: status === 500 ? 'An internal error occurred.' : error.message });
    }
  });

  app.on('listening', () => {
    const fixtures = configuredSources.filter(source => source.kind === 'fixture');
    initial = Promise.all([
      loadEvents().catch(error => console.error('Event fixture could not be loaded:', error.message)),
      ...fixtures.map(source => scanner.run(source.id))
    ]);
    scanner.runScheduled();
    timer = setInterval(() => scanner.runScheduled(), intervalMs);
    timer.unref();
    store.prune(Date.now());
    pruning = setInterval(() => store.prune(Date.now()), 600000);
    pruning.unref();
  });
  app.on('close', () => { clearInterval(timer); clearInterval(pruning); store.close(); });
  return { app, rescan: () => scanner.run().then(() => dashboard(null).summary), summary: () => dashboard(null).summary };
}

if (require.main === module) {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error('PORT must be an integer from 0 to 65535.');
    process.exitCode = 1;
  } else {
    const { app } = createApp();
    app.once('error', error => {
      console.error(error.code === 'EADDRINUSE'
        ? 'Port ' + port + ' is already in use. Set an available port in PowerShell with $env:PORT = "3153".'
        : 'CloudSentinel could not start: ' + error.message);
      process.exitCode = 1;
    });
    app.listen(port, '127.0.0.1', () => {
      console.log('CloudSentinel http://127.0.0.1:' + app.address().port);
    });
  }
}

module.exports = { createApp };
