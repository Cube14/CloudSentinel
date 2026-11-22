'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server/server');
const { client, listen, login, password, seedAdmin, adminEmail } = require('./session');

const post = (browser, route, body = {}, options) => browser.request(route, { method: 'POST', body, ...options });
const email = 'viewer@example.test';

async function launch(t, options = {}) {
  const { app } = createApp({ env: {}, dbPath: ':memory:', ...options });
  const base = await listen(app);
  t.after(() => app.listening ? new Promise(resolve => app.close(resolve)) : null);
  return { app, base };
}

async function signup(browser, email = 'viewer@example.test') {
  assert.equal((await browser.request('/api/auth/session')).status, 200);
  return post(browser, '/api/auth/signup', { email, password, role: 'admin' });
}

async function temporaryDB(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudsentinel-auth-'));
  const dbPath = path.join(directory, 'auth.sqlite');
  t.after(async () => {
    for (const filename of [dbPath, dbPath + '-wal', dbPath + '-shm']) await fs.rm(filename, { force: true });
    await fs.rmdir(directory);
  });
  return dbPath;
}

test('sensitive APIs require authentication and signup grants viewer access only', async t => {
  const { base } = await launch(t);
  const browser = client(base);
  for (const route of ['/api/dashboard', '/api/dashboard/summary', '/api/environments', '/api/assets',
    '/api/findings', '/api/findings/resolved', '/api/scans/latest', '/api/iam', '/api/incidents', '/api/events', '/api/audit']) {
    assert.equal((await browser.request(route)).status, 401, route);
  }
  assert.equal((await post(browser, '/api/scans/run')).status, 401);
  const created = await signup(browser, ' Viewer@Example.Test ');
  assert.equal(created.status, 201);
  const { user, googleEnabled } = await created.json();
  assert.deepEqual(Object.keys(user).sort(), ['email', 'id', 'role']);
  assert.equal(user.email, email);
  assert.equal(user.role, 'viewer');
  assert.equal(googleEnabled, false);
  assert.equal((await browser.request('/api/dashboard')).status, 200);
  const [incident] = await (await browser.request('/api/incidents')).json();
  for (const route of ['/api/scans/run', '/api/events', '/api/simulations/run',
    '/api/incidents/' + incident.id + '/investigate', '/api/incidents/' + incident.id + '/respond']) {
    assert.equal((await post(browser, route)).status, 403, route);
  }
  assert.equal((await browser.request('/api/auth/audit')).status, 403);
  assert.equal((await post(browser, '/api/auth/google/start')).status, 404);
});

test('CSRF and origin checks protect signup, login, logout and every admin operation', async t => {
  const dbPath = await temporaryDB(t);
  await seedAdmin(dbPath);
  const { app, base } = await launch(t, { dbPath });
  try {
    const browser = client(base);
    const bootstrap = await browser.request('/api/auth/session');
    assert.match(bootstrap.headers.getSetCookie()[0], /HttpOnly; SameSite=Strict/);
    const stale = browser.csrf;
    for (const route of ['/api/auth/signup', '/api/auth/login']) {
      assert.equal((await post(browser, route, { email, password }, { token: '' })).status, 403);
      assert.equal((await post(browser, route, { email, password }, { headers: { Origin: 'http://example.org' } })).status, 403);
    }
    await login(browser);
    assert.notEqual(browser.csrf, stale);
    assert.equal((await post(browser, '/api/scans/run', {}, { token: stale })).status, 403);
    assert.equal((await post(browser, '/api/scans/run')).status, 200);
    assert.equal((await post(browser, '/api/auth/logout', {}, { token: '' })).status, 403);
    assert.equal((await post(browser, '/api/auth/logout')).status, 200);
    assert.equal((await browser.request('/api/dashboard')).status, 401);
  } finally { await new Promise(resolve => app.close(resolve)); }
});

test('SQLite persists identities, audit and server-side sessions, and supports rotation, expiry and logout', async t => {
  const dbPath = await temporaryDB(t);
  await seedAdmin(dbPath);
  const first = await launch(t, { dbPath });
  const browser = client(first.base);
  try {
    await browser.request('/api/auth/session');
    const signedIn = await post(browser, '/api/auth/login', { email: adminEmail, password });
    assert.equal(signedIn.status, 200);
    assert.match(signedIn.headers.getSetCookie().find(line => line.startsWith('cs_session=')), /HttpOnly; SameSite=Strict/);
    const firstToken = browser.cookies.get('cs_session');
    assert.ok(firstToken);
    assert.equal((await post(browser, '/api/auth/login', { email: adminEmail, password })).status, 200);
    assert.notEqual(browser.cookies.get('cs_session'), firstToken);
    assert.equal((await browser.request('/api/dashboard', { headers: { Cookie: 'cs_session=' + firstToken } })).status, 401);
    const [incident] = await (await browser.request('/api/incidents')).json();
    assert.equal((await post(browser, '/api/incidents/' + incident.id + '/respond', {
      action: 'DISABLE_ACCESS_KEY', decision: 'approve', approvedBy: 'ignored'
    })).status, 201);
  } finally { await new Promise(resolve => first.app.close(resolve)); }

  const second = await launch(t, { dbPath });
  try {
    const restored = client(second.base);
    restored.cookies.set('cs_session', browser.cookies.get('cs_session'));
    assert.equal((await (await restored.request('/api/auth/session')).json()).user.role, 'admin');
    const [entry] = await (await restored.request('/api/audit?environment=aws-lab')).json();
    assert.equal(entry.approvedBy, adminEmail);
    assert.equal((await restored.request('/api/auth/audit')).status, 200);
    const old = restored.cookies.get('cs_session');
    assert.equal((await post(restored, '/api/auth/logout')).status, 200);
    restored.cookies.set('cs_session', old);
    assert.equal((await restored.request('/api/dashboard')).status, 401);
    await login(restored);
    const db = new DatabaseSync(dbPath);
    try {
      const stored = db.prepare('SELECT password FROM users WHERE email = ?').get(adminEmail).password;
      assert.match(stored, /^[a-f0-9]{32}:[a-f0-9]{128}$/);
      const session = db.prepare('SELECT token_hash FROM sessions LIMIT 1').get();
      assert.notEqual(session.token_hash, restored.cookies.get('cs_session'));
      assert.match(session.token_hash, /^[a-f0-9]{64}$/);
      db.exec('UPDATE sessions SET expires_at = 0');
    } finally { db.close(); }
    assert.equal((await restored.request('/api/dashboard')).status, 401);
  } finally { await new Promise(resolve => second.app.close(resolve)); }
});

test('invalid logins are rate-limited by normalized account', async t => {
  const { base } = await launch(t);
  const browser = client(base);
  assert.equal((await signup(browser)).status, 201);
  await post(browser, '/api/auth/logout');
  for (let index = 0; index < 5; index++) {
    const response = await post(browser, '/api/auth/login', { email: index % 2 ? email.toUpperCase() : email, password: password + ' wrong' });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, 'Invalid email or password.');
  }
  const limited = await post(browser, '/api/auth/login', { email, password });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('Retry-After')) > 0);
  assert.equal((await post(browser, '/api/auth/login', { email: 'another@example.test', password })).status, 401);
});

test('the local CLI provisions an administrator and rejects an existing email', async t => {
  const dbPath = await temporaryDB(t);
  async function provision() {
    const script = path.join(__dirname, '..', 'server', 'setup-admin.js');
    const child = spawn(process.execPath, [script, adminEmail], {
      env: { ...process.env, AUTH_DB_PATH: dbPath }, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true
    });
    child.stdin.end(password + '\n');
    return new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  }
  assert.equal(await provision(), 0);
  assert.equal(await provision(), 1);
  const { app, base } = await launch(t, { dbPath });
  try {
    const browser = client(base);
    assert.equal((await login(browser)).user.role, 'admin');
    const activity = await (await browser.request('/api/auth/audit')).json();
    assert.ok(activity.some(entry => entry.action === 'admin-provisioned' && entry.actor === adminEmail));
  } finally { await new Promise(resolve => app.close(resolve)); }
});
