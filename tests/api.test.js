'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createApp } = require('../server/server');
const { adminEmail, client, listen, login, seedAdmin } = require('./session');

test('API integration health/scan/findings/simulation/audit', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudsentinel-api-'));
  const dbPath = path.join(directory, 'auth.sqlite');
  await seedAdmin(dbPath);
  const { app } = createApp({ env: {}, dbPath });
  const browser = client(await listen(app));
  t.after(async () => {
    await new Promise(resolve => app.close(resolve));
    await fs.rm(dbPath);
    await fs.rmdir(directory);
  });
  assert.equal((await browser.request('/api/health')).status, 200);
  await login(browser);
  const summary = await (await browser.request('/api/dashboard/summary')).json();
  assert.equal(summary.assets, 12);
  assert.ok(summary.findings > 0);
  assert.equal((await browser.request('/api/scans/run', { method: 'POST' })).status, 200);
  const incidents = await (await browser.request('/api/incidents')).json();
  assert.equal(incidents.length, 1);
  const result = await browser.request('/api/incidents/' + incidents[0].id + '/respond', {
    method: 'POST', body: { decision: 'approve', action: 'QUARANTINE_INSTANCE', approvedBy: 'untrusted-claim' }
  });
  assert.equal(result.status, 201);
  const log = await result.json();
  assert.equal(log.environment, 'simulation');
  assert.equal(log.approvedBy, adminEmail);
  assert.equal((await (await browser.request('/api/audit')).json()).length, 1);
  assert.equal((await browser.request('/api/events', { method: 'POST', body: {} })).status, 400);
});
