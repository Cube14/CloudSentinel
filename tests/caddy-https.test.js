'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:net');
const { request } = require('node:https');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { createApp } = require('../server/server');
const { client, listen, login, seedAdmin, password } = require('./session');

const binary = process.env.CADDY_TEST_BIN;
test('actual Caddy HTTPS strips incoming proxy metadata and protects the audit and S3 Lab APIs',
  { skip: !binary && 'Set CADDY_TEST_BIN to a local Caddy v2 binary', timeout: 30000 }, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-caddy-'));
    const caDir = join(dir, 'ca');
    const dbPath = join(dir, 'auth.sqlite');
    const ports = createServer();
    ports.listen(0, '127.0.0.1');
    await once(ports, 'listening');
    const port = ports.address().port;
    await new Promise(resolve => ports.close(resolve));
    const origin = 'https://127.0.0.1:' + port;
    const token = randomBytes(32).toString('hex');
    await mkdir(caDir);
    await seedAdmin(dbPath);
    await writeFile(join(dir, 'index.html'), '<div id="root"></div>');
    const live = process.env.FLOCI_LIVE_TEST === '1';
    const { app } = createApp({ dbPath, clientDir: dir, env: { LAN_PROXY: '1', LAN_HTTPS_ORIGIN: origin,
      LAN_PROXY_TOKEN: token, ...(live ? { FLOCI_ENDPOINT: 'http://127.0.0.1:4566', FLOCI_LAB_ENABLED: '1' } : {}) } });
    await listen(app);
    const caddy = spawn(resolve(binary), ['run', '--config', resolve('deploy/Caddyfile'), '--adapter', 'caddyfile'], {
      windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, CS_CADDY_ORIGIN: origin, CS_CADDY_PORT: String(port), CS_CADDY_BIND: '127.0.0.1',
        CS_CADDY_HOST: '127.0.0.1', CS_CADDY_SUBNET: '127.0.0.0/8', CS_CADDY_DATA: caDir.replaceAll('\\', '/'),
        CS_NODE_PORT: String(app.address().port), LAN_PROXY_TOKEN: token }
    });
    let startupError;
    caddy.on('error', error => { startupError = error.code; });
    caddy.stderr.resume();
    t.after(async () => {
      const closed = caddy.pid && caddy.exitCode === null && caddy.signalCode === null ? once(caddy, 'close') : null;
      if (closed) { caddy.kill(); await closed; }
      await new Promise(resolve => app.close(resolve));
      await rm(dir, { recursive: true, force: true });
    });

    let ca;
    const fetcher = (url, options = {}) => new Promise((resolve, reject) => {
      const incoming = request(url, { ...options, ca, rejectUnauthorized: true, agent: false }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => {
          const result = {
            status: response.statusCode,
            headers: { get: key => response.headers[key.toLowerCase()], getSetCookie: () => response.headers['set-cookie'] || [] },
            json: async () => JSON.parse(Buffer.concat(chunks).toString('utf8')),
            text: async () => Buffer.concat(chunks).toString('utf8'),
            clone: () => result
          };
          resolve(result);
        });
      });
      incoming.on('error', reject);
      incoming.setTimeout(3000, () => incoming.destroy(new Error('HTTPS request timed out')));
      incoming.end(options.body);
    });
    let health;
    for (let attempt = 0; attempt < 80 && !health; attempt++) {
      if (startupError || caddy.exitCode !== null) throw new Error('Caddy startup failed: ' + (startupError || caddy.exitCode));
      try {
        ca = await readFile(join(caDir, 'pki', 'authorities', 'local', 'root.crt'));
        health = await fetcher(origin + '/api/health');
      } catch { await delay(125); }
    }
    assert.equal(health?.status, 200);
    const browser = client(origin, fetcher);
    const post = (route, body, options = {}) => browser.request(route, { method: 'POST', body, ...options });
    let response = await browser.request('/api/auth/session');
    assert.match(response.headers.getSetCookie()[0], /^__Host-cs_csrf=.*HttpOnly; SameSite=Strict;.*Secure$/);
    const viewer = { email: 'caddy-viewer@example.test', password };
    assert.equal((await post('/api/auth/signup', viewer)).status, 202);
    response = await post('/api/auth/login', viewer);
    assert.equal((await response.json()).user.role, 'viewer');
    assert.match(response.headers.getSetCookie()[0], /^__Host-cs_session=.*HttpOnly; SameSite=Strict;.*Secure$/);
    assert.equal((await browser.request('/api/auth/audit/events')).status, 403);
    assert.equal((await browser.request('/api/lab/s3')).status, 403);
    assert.equal((await browser.request('/workspace/floci-s3')).status, 200);
    assert.equal((await browser.request('/api/dashboard')).status, 200);
    assert.equal((await post('/api/auth/logout', {})).status, 200);
    await login(browser);
    const audit = await browser.request('/api/auth/audit/events?kind=auth', { headers: {
      'X-Forwarded-For': '198.51.100.10', 'X-CloudSentinel-Proxy': 'forged', Forwarded: 'for=198.51.100.10'
    } });
    assert.equal(audit.status, 200);
    assert.ok((await audit.json()).entries.some(event => event.channel === 'https-proxy' && event.sourceIp === '127.0.0.1'));
    assert.equal((await browser.request('/api/lab/s3')).status, live ? 200 : 503);
    assert.equal((await post('/api/lab/s3/scan', {}, { token: '' })).status, 403);
    assert.equal((await post('/api/scans/run', {}, { headers: { Origin: 'https://other.example' } })).status, 403);
  });
