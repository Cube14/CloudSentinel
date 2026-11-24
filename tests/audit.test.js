'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createApp } = require('../server/server');
const { client, listen, login, seedAdmin, adminEmail, password } = require('./session');

test('audit survives login rollback and restart, supports pagination, metrics, search and CSV', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-audit-'));
  const dbPath = join(dir, 'audit.sqlite');
  const original = new DatabaseSync(dbPath);
  original.exec('CREATE TABLE audit (id TEXT PRIMARY KEY, kind TEXT NOT NULL, environment TEXT, timestamp TEXT NOT NULL, payload TEXT NOT NULL)');
  const legacy = { id: 'old-event', action: 'password-login', actor: 'legacy@example.test', timestamp: '2025-01-01T00:00:00.000Z' };
  original.prepare("INSERT INTO audit VALUES (?, 'auth', NULL, ?, ?)").run(legacy.id, legacy.timestamp, JSON.stringify(legacy));
  original.close();
  await seedAdmin(dbPath);
  let app;
  t.after(async () => {
    if (app?.listening) await new Promise(resolve => app.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  async function boot() {
    ({ app } = createApp({ dbPath, env: {}, sources: [] }));
    return client(await listen(app));
  }
  let browser = await boot();
  await browser.request('/api/auth/session');
  const http = (body, route = '/api/auth/login') => browser.request(route, { method: 'POST', body });
  const blocker = new DatabaseSync(dbPath);
  blocker.exec("CREATE TRIGGER reject_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT, 'Test session write failure'); END");
  assert.equal((await http({ email: adminEmail, password })).status, 500);
  blocker.exec('DROP TRIGGER reject_session');
  assert.throws(() => blocker.exec("DELETE FROM audit WHERE id = 'old-event'"), /append-only/);
  assert.throws(() => blocker.exec("UPDATE audit SET timestamp = 'now' WHERE id = 'old-event'"), /append-only/);
  blocker.close();
  await login(browser);
  const account = 'absent@example.test';
  const wrong = 'bad password for the audit regression';
  const anonymous = client('http://127.0.0.1:' + app.address().port);
  await anonymous.request('/api/auth/session');
  for (let count = 0; count < 6; count++) {
    const response = await anonymous.request('/api/auth/login', { method: 'POST', body: { email: account, password: wrong } });
    assert.equal(response.status, count === 5 ? 429 : 401);
  }
  const logout = await http({}, '/api/auth/logout');
  assert.equal(logout.status, 200);
  await new Promise(resolve => app.close(resolve));

  browser = await boot();
  await login(browser);
  const path = '/api/auth/audit/events';
  const response = await browser.request(path + '?kind=auth&page=1&limit=2');
  assert.equal(response.status, 200);
  const first = await response.json();
  assert.deepEqual([first.metrics.attempts, first.metrics.successes, first.metrics.failures], [10, 3, 7]);
  assert.equal(first.metrics.failedByDay.at(-1).count, 7);
  assert.ok(first.metrics.lastLogin);
  const second = await (await browser.request(path + '?kind=auth&page=2&limit=2')).json();
  assert.equal(first.total, second.total);
  assert.ok(first.entries.every(event => second.entries.every(next => next.id !== event.id)));
  const limited = await (await browser.request(path + '?q=' + account + '&action=rate-limit-triggered')).json();
  assert.equal(limited.total, 1);
  assert.equal(limited.entries[0].actor, null);
  const allAttempts = await (await browser.request(path + '?q=' + account + '&action=password-login-attempted')).json();
  assert.equal(allAttempts.total, 6);
  assert.ok(allAttempts.entries.every(event => event.sourceIp === '127.0.0.1'));
  const old = await (await browser.request(path + '?q=' + legacy.actor)).json();
  assert.equal(old.entries[0].id, legacy.id);
  const { entries: failures } = await (await browser.request(path + '?q=' + adminEmail + '&status=failure')).json();
  assert.ok(failures.some(event => event.details.code === 500));
  const download = await browser.request(path + '?action=password-login&status=failure&format=csv');
  assert.match(download.headers.get('content-type'), /^text\/csv/);
  assert.match(download.headers.get('content-disposition'), /attachment/);
  const csv = await download.text();
  assert.equal(csv.trimEnd().split('\r\n').length, 8);
  for (const secret of [password, wrong, browser.csrf, browser.cookies.get('cs_session'), 'accountKey']) {
    assert.ok(!csv.includes(secret));
    assert.ok(!JSON.stringify(first).includes(secret));
  }
});
