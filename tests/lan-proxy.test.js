'use strict';

const http = require('node:http');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, copyFile, rm } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { randomBytes } = require('node:crypto');
const { createApp } = require('../server/server');
const { configureBoundary } = require('../server/lan-proxy');
const { adminEmail, client, listen, password, seedAdmin } = require('./session');

const origin = 'https://192.168.50.2';
const token = randomBytes(32).toString('hex');
const env = { LAN_PROXY: '1', LAN_HTTPS_ORIGIN: origin, LAN_PROXY_TOKEN: token, CLIENT_DEV_ORIGIN: 'http://127.0.0.1:5173' };
const headers = {
  Host: '192.168.50.2', Origin: origin, 'X-CloudSentinel-Proxy': token,
  'X-Forwarded-Host': '192.168.50.2', 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '192.168.50.3',
};

// Use the underlying HTTP request so the stipulated Host reaches the Node boundary.
function fetchWithHost(url, { method, headers, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method, headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => {
        const content = new Headers();
        for (const [name, values] of Object.entries(response.headersDistinct)) {
          for (const value of values) content.append(name, value);
        }
        resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: content }));
      });
    });
    request.on('error', reject);
    request.end(body);
  });
}

test('proxy config fails closed and HTTPS OAuth requires a matching DNS name', () => {
  assert.throws(() => configureBoundary({ ...env, LAN_PROXY_TOKEN: 'weak' }), /LAN_PROXY_TOKEN/);
  assert.throws(() => configureBoundary({ ...env, LAN_HTTPS_ORIGIN: 'http://192.168.50.2' }), /LAN_HTTPS_ORIGIN/);
  assert.throws(() => configureBoundary({ ...env, LAN_HTTPS_ORIGIN: origin + '/' }), /LAN_HTTPS_ORIGIN/);
  assert.equal(configureBoundary(env).request({ socket: { remoteAddress: '192.168.50.5' } }, 3153), null);
  assert.equal(configureBoundary(env).request({ socket: { remoteAddress: '127.0.0.1' }, headersDistinct: {
    host: ['localhost:3153', '192.168.50.2'],
  } }, 3153), null);
  assert.throws(() => createApp({ dbPath: ':memory:', env: { ...env, LAN_GOOGLE_CLIENT_ID: 'fixture',
    LAN_GOOGLE_CLIENT_SECRET: 'fixture', LAN_GOOGLE_REDIRECT_URI: origin + '/api/auth/google/callback',
  } }), /registered DNS domain/);
});

test('proxy requires authenticated loopback metadata and exact host/origin', async t => {
  const { app } = createApp({ env, dbPath: ':memory:' });
  const base = await listen(app);
  t.after(() => new Promise(resolve => app.close(resolve)));
  const request = incoming => fetchWithHost(base + '/api/health', { headers: incoming });
  assert.equal((await request(headers)).status, 200);
  assert.equal((await request({ Host: headers.Host })).status, 403);
  assert.equal((await request()).status, 200);
  for (const changed of [
    { Host: 'elsewhere.test' }, { Origin: 'http://127.0.0.1:5173' },
    { Origin: 'null' }, { Origin: 'http://192.168.50.2' }, { 'X-Forwarded-Proto': 'http' },
    { 'X-Forwarded-Host': 'other.test' }, { 'X-Forwarded-For': '10.1.2.3, 10.1.2.4' },
    { Forwarded: 'proto=https' }, { 'X-Forwarded-Port': '443' },
    { 'X-CloudSentinel-Proxy': '0'.repeat(64) },
  ]) assert.equal((await request({ ...headers, ...changed })).status, 403, Object.keys(changed)[0]);
  assert.equal((await request({ 'X-Forwarded-For': '192.168.50.3' })).status, 403);
});

test('LAN signup, login, reload and logout use scoped Secure cookies, CSRF and existing roles', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cloudsentinel-lan-'));
  const dbPath = join(dir, 'test.sqlite');
  await seedAdmin(dbPath);
  await mkdir(join(dir, 'assets'));
  await writeFile(join(dir, 'index.html'), '<div id="root"></div>');
  await copyFile(join(__dirname, '../client/src/media/destinations/overview.webm'), join(dir, 'assets/overview.test.webm'));
  const { app } = createApp({ env: { ...env, GOOGLE_CLIENT_ID: 'fixture', GOOGLE_CLIENT_SECRET: 'fixture',
    GOOGLE_REDIRECT_URI: 'http://localhost:3153/api/auth/google/callback' }, dbPath, clientDir: dir });
  const base = await listen(app);
  t.after(async () => { await new Promise(resolve => app.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  const viewer = client(base, fetchWithHost);
  const request = (path, options = {}) => viewer.request(path, { ...options, headers: { ...headers, ...options.headers } });
  const bootstrap = await request('/api/auth/session');
  assert.equal((await bootstrap.json()).googleEnabled, false);
  assert.match(bootstrap.headers.getSetCookie()[0], /^__Host-cs_csrf=.*HttpOnly; SameSite=Strict;.*Secure$/);
  const body = { email: 'lan-viewer@example.test', password };
  const post = { method: 'POST', body };
  assert.equal((await request('/api/auth/signup', { ...post, token: '' })).status, 403);
  assert.equal((await request('/api/auth/signup', { ...post, headers: { Origin: 'https://other.test' } })).status, 403);
  const signup = await request('/api/auth/signup', post);
  assert.equal(signup.status, 202);
  const signedIn = await request('/api/auth/login', post);
  assert.equal((await signedIn.json()).user.role, 'viewer');
  assert.match(signedIn.headers.getSetCookie()[0], /^__Host-cs_session=.*HttpOnly; SameSite=Strict;.*Secure$/);
  assert.equal((await request('/api/auth/audit')).status, 403);
  assert.equal((await request('/api/scans/run', { method: 'POST', body: {} })).status, 403);
  assert.equal((await request('/workspace/findings')).status, 200);
  const reel = await request('/assets/overview.test.webm');
  assert.equal(reel.headers.get('content-type'), 'video/webm');
  assert.match(reel.headers.get('cache-control'), /immutable/);
  assert.equal(Buffer.from(await reel.arrayBuffer()).subarray(0, 4).toString('hex'), '1a45dfa3');
  assert.equal((await (await request('/api/auth/session')).json()).user.email, body.email);
  assert.equal((await viewer.request('/api/dashboard')).status, 401);
  assert.equal((await request('/api/auth/logout', { method: 'POST', body: {} })).status, 200);
  assert.equal((await (await request('/api/auth/session')).json()).user, null);
  assert.equal((await request('/api/auth/login', post)).status, 200);

  const admin = client(base, fetchWithHost);
  assert.equal((await admin.request('/api/auth/session', { headers })).status, 200);
  const login = await admin.request('/api/auth/login', { method: 'POST', headers, body: { email: adminEmail, password } });
  assert.equal((await login.json()).user.role, 'admin');
  assert.equal((await admin.request('/api/auth/audit', { headers })).status, 200);
  const local = await fetch(base + '/api/auth/session');
  assert.equal((await local.json()).googleEnabled, true);
  assert.doesNotMatch(local.headers.getSetCookie()[0], /Secure|__Host-/);
  assert.equal((await request('/api/auth/google/callback')).status, 404);
});

test('LAN login throttling separates addresses supplied by the authenticated proxy', async t => {
  const { app } = createApp({ env, dbPath: ':memory:' });
  const base = await listen(app);
  t.after(() => new Promise(resolve => app.close(resolve)));
  const browser = client(base, fetchWithHost);
  assert.equal((await browser.request('/api/auth/session', { headers })).status, 200);
  const login = from => browser.request('/api/auth/login', {
    method: 'POST', body: {}, headers: { ...headers, 'X-Forwarded-For': from },
  });
  for (let i = 0; i < 25; i++) assert.equal((await login('192.168.50.3')).status, 401);
  assert.equal((await login('192.168.50.3')).status, 429);
  assert.equal((await login('192.168.50.4')).status, 401);
});
