'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { setTimeout: delay } = require('node:timers/promises');
const { createApp } = require('../server/server');
const { client, listen, login, seedAdmin } = require('./session');

async function start(t, options) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudsentinel-monitoring-'));
  const dbPath = path.join(directory, 'auth.sqlite');
  await seedAdmin(dbPath);
  const { app } = createApp({ ...options, dbPath });
  const browser = client(await listen(app));
  t.after(async () => {
    await new Promise(resolve => app.close(resolve));
    await fs.rm(dbPath);
    await fs.rmdir(directory);
  });
  await login(browser);
  return async (route, method = 'GET', body, headers) => {
    const response = await browser.request(route, { method, body, headers });
    return [response.status, await response.json()];
  };
}

test('dashboard scopes AWS, Azure and GCP assets, findings, incidents and audit', async t => {
  const request = await start(t, { env: {} });
  const [, all] = await request('/api/dashboard');
  assert.equal(all.summary.assets, 12);
  assert.equal(all.summary.incidents, 1);
  assert.equal(all.environments.length, 3);
  for (const [provider, count] of [['aws', 8], ['azure', 5], ['gcp', 1]]) {
    const environment = provider + '-lab';
    const [status, data] = await request('/api/dashboard?environment=' + environment);
    assert.equal(status, 200);
    assert.equal(data.assets.length, 4);
    assert.equal(data.findings.length, count);
    assert.equal(data.summary.incidents, provider === 'aws' ? 1 : 0);
    assert.ok(data.findings.every(f => f.environment === environment && f.source === 'fixture'));
    assert.equal(data.summary.providers[0].kind, 'fixture');
  }
  const incident = all.incidents[0];
  const action = '/api/incidents/' + incident.id + '/respond';
  const response = JSON.stringify({ decision: 'approve', action: 'DISABLE_ACCESS_KEY', approvedBy: 'test' });
  assert.equal((await request(action + '?environment=gcp-lab', 'POST', response))[0], 404);
  assert.equal((await request(action + '?environment=aws-lab', 'POST', response))[0], 201);
  assert.equal((await request('/api/audit?environment=gcp-lab'))[1].length, 0);
  assert.equal((await request('/api/audit?environment=aws-lab'))[1].length, 1);
  assert.equal((await request('/api/dashboard?environment=unknown'))[0], 404);
  assert.equal((await request('/api/events', 'POST', 'null'))[0], 400);
  assert.equal((await request('/api/health', 'POST'))[0], 404);
  assert.equal((await request('/api/scans/run', 'POST', '{}', { Origin: 'http://example.org' }))[0], 403);
});

test('fixture edits appear after rescans and failed reads preserve the successful snapshot', async t => {
  const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudsentinel-test-'));
  const assetsPath = path.join(fixtureDir, 'aws.json');
  const seed = path.join(__dirname, '..', 'fixtures');
  const files = ['aws.json', 'azure.json', 'gcp.json', 'events.json'];
  t.after(async () => {
    await Promise.all(files.map(name => fs.rm(path.join(fixtureDir, name), { force: true })));
    await fs.rmdir(fixtureDir);
  });
  await Promise.all(files.map(name => fs.copyFile(path.join(seed, name), path.join(fixtureDir, name))));
  const original = JSON.parse(await fs.readFile(assetsPath, 'utf8'));
  const request = await start(t, { env: {}, fixtureDir });
  const dashboard = '/api/dashboard?environment=aws-lab';
  const run = '/api/scans/run?environment=aws-lab';
  const [, first] = await request(dashboard);
  const finding = first.findings.find(f => f.ruleId === 'CSPM-001');
  assert.equal((await request(run, 'POST'))[0], 200);
  const [, repeated] = await request(dashboard);
  assert.equal(repeated.findings.length, first.findings.length);
  assert.equal(repeated.findings.find(f => f.id === finding.id).detectedAt, finding.detectedAt);

  await fs.writeFile(assetsPath, '{"bad"');
  assert.equal((await request(run, 'POST'))[0], 503);
  const [, failed] = await request(dashboard);
  assert.equal(failed.summary.providers[0].status, 'failed');
  assert.equal(failed.summary.lastScan, repeated.summary.lastScan);
  assert.deepEqual(failed.assets, repeated.assets);
  assert.deepEqual(failed.findings, repeated.findings);
  assert.equal(failed.history[0].findings, null);

  const secured = structuredClone(original);
  secured.assets[0].public = false;
  await fs.writeFile(assetsPath, '\uFEFF' + JSON.stringify(secured));
  assert.equal((await request(run, 'POST'))[0], 200);
  const [, repaired] = await request(dashboard);
  assert.equal(repaired.summary.providers[0].status, 'succeeded');
  assert.ok(!repaired.findings.some(f => f.id === finding.id));
  assert.equal(repaired.resolved.find(f => f.id === finding.id).status, 'RESOLVED');
  await fs.writeFile(assetsPath, JSON.stringify(original));
  await request(run, 'POST');
  const [, reopened] = await request(dashboard);
  assert.equal(reopened.findings.find(f => f.id === finding.id).detectedAt, finding.detectedAt);
  assert.ok(!reopened.resolved.some(f => f.id === finding.id));
});

test('scheduled collection updates the dashboard without a manual scan', async t => {
  let exposed = false;
  const source = { id: 'aws-lab', provider: 'aws', kind: 'fixture', label: 'AWS test fixture',
    collect: () => [{ id: 'bucket', name: 'bucket', type: 'storage', public: exposed }] };
  const request = await start(t, { env: { SCAN_INTERVAL_MS: '1000' }, sources: [source] });
  const [, first] = await request('/api/dashboard');
  assert.equal(first.summary.findings, 0);
  exposed = true;
  const deadline = Date.now() + 4500;
  let next;
  do {
    await delay(100);
    [, next] = await request('/api/dashboard');
  } while (next.summary.findings === 0 && Date.now() < deadline);
  assert.equal(next.summary.findings, 1);
  assert.ok(next.summary.lastScan > first.summary.lastScan);
});

test('simultaneous requests share scans and queue independent environments', async t => {
  let runs = 0;
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const source = { id: 'aws-floci', provider: 'aws', kind: 'emulator', label: 'Test source',
    async collect() {
      runs++;
      await held;
      throw new Error('Service unavailable');
    } };
  const request = await start(t, { env: {}, sources: [source, {
    id: 'second-env', provider: 'aws', kind: 'emulator', label: 'Second test source',
    collect: () => []
  }] });
  const first = request('/api/scans/run?environment=aws-floci', 'POST');
  const second = request('/api/scans/run?environment=aws-floci', 'POST');
  try {
    const [, pending] = await request('/api/dashboard?environment=aws-floci');
    assert.equal(pending.summary.providers[0].status, 'running');
    assert.equal(pending.environments.find(entry => entry.id === 'second-env').status, 'queued');
    assert.equal(pending.summary.findings, null);
    assert.equal(runs, 1);
  } finally {
    release();
  }
  for (const response of await Promise.all([first, second])) {
    assert.equal(response[0], 503);
    assert.equal(response[1].findings, null);
  }
  assert.equal(runs, 1);
});

test('unscanned and failed emulator snapshots remain distinct from a clean result', async t => {
  let failed = true;
  const request = await start(t, {
    env: {},
    sources: [{ id: 'aws-floci', provider: 'aws', kind: 'emulator', label: 'Test source',
      collect() {
        if (failed) throw new Error('Unsupported operation');
        return [];
      } }]
  });
  const run = '/api/scans/run?environment=aws-floci';
  const [status, failure] = await request(run, 'POST');
  assert.equal(status, 503);
  assert.equal(failure.lastScan, null);
  assert.equal(failure.assets, null);
  failed = false;
  const [recovered, clean] = await request(run, 'POST');
  assert.equal(recovered, 200);
  assert.equal(clean.assets, 0);
  assert.equal(clean.findings, 0);
  assert.ok(clean.lastScan);
});
