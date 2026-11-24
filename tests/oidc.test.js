'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createServer } = require('node:http');
const { createHash, generateKeyPairSync, sign } = require('node:crypto');
const { createApp } = require('../server/server');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { client, login, password, seedAdmin } = require('./session');

const issuer = 'https://accounts.google.com';
const id = 'cloudsentinel-test-client';
const tokenEndpoint = 'https://oauth2.googleapis.com/token';
const jwks = 'https://www.googleapis.com/oauth2/v3/certs';
const callbackPath = '/api/auth/google/callback';
const json = payload => Response.json(payload);
const encoded = object => Buffer.from(JSON.stringify(object)).toString('base64url');

test('Google OIDC validates state, browser binding, PKCE, nonce, signature, replay and viewer provisioning', async t => {
  // Local provider fixture supplies discovery, JWKS and signed tokens to the real openid-client implementation.
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), use: 'sig', kid: 'test-key', alg: 'RS256' };
  const temporary = createServer();
  temporary.listen(0, '127.0.0.1');
  await once(temporary, 'listening');
  const port = temporary.address().port;
  await new Promise(resolve => temporary.close(resolve));
  const base = 'http://127.0.0.1:' + port;
  const redirect = base + callbackPath;
  let authorization;
  let tokenCalls = 0;
  let verified = true;
  let email = 'google-viewer@example.test';
  async function oidcFetch(input, options) {
    const href = String(input);
    if (href === issuer + '/.well-known/openid-configuration') {
      return json({ issuer, authorization_endpoint: issuer + '/authorize', token_endpoint: tokenEndpoint,
        jwks_uri: jwks, response_types_supported: ['code'], token_endpoint_auth_methods_supported: ['client_secret_post'],
        code_challenge_methods_supported: ['S256'], id_token_signing_alg_values_supported: ['RS256'] });
    }
    if (href === jwks) return json({ keys: [jwk] });
    assert.equal(href, tokenEndpoint);
    tokenCalls++;
    const body = new URLSearchParams(options.body);
    assert.equal(body.get('redirect_uri'), redirect);
    assert.equal(body.get('grant_type'), 'authorization_code');
    assert.equal(body.get('client_id'), id);
    assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'),
      authorization.searchParams.get('code_challenge'));
    const code = body.get('code');
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss: issuer, aud: id, iat: now, exp: now + 300, sub: 'google-' + email,
      email, email_verified: verified, nonce: code === 'wrong-nonce' ? 'wrong' : authorization.searchParams.get('nonce') };
    const unsigned = encoded({ alg: 'RS256', kid: 'test-key' }) + '.' + encoded(claims);
    const signature = code === 'wrong-signature' ? Buffer.alloc(256) : sign('RSA-SHA256', Buffer.from(unsigned), privateKey);
    return json({ access_token: 'protocol-fixture-access-token', token_type: 'Bearer',
      id_token: unsigned + '.' + signature.toString('base64url') });
  }
  const dir = await mkdtemp(join(tmpdir(), 'cs-oidc-'));
  const dbPath = join(dir, 'auth.sqlite');
  await seedAdmin(dbPath);
  const { app } = createApp({
    dbPath, oidcFetch,
    env: { GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: 'protocol-fixture-secret', GOOGLE_REDIRECT_URI: redirect }
  });
  app.listen(port, '127.0.0.1');
  await once(app, 'listening');
  t.after(async () => {
    await new Promise(resolve => app.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });

  async function start(browser) {
    const { googleEnabled } = await (await browser.request('/api/auth/session')).json();
    assert.equal(googleEnabled, true);
    const result = await browser.request('/api/auth/google/start', { method: 'POST', body: {} });
    assert.equal(result.status, 200);
    assert.match(result.headers.getSetCookie()[0], /HttpOnly; SameSite=Lax; Max-Age=300/);
    authorization = new URL((await result.json()).url);
    assert.equal(authorization.origin, issuer);
    assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authorization.searchParams.get('redirect_uri'), redirect);
    return authorization.searchParams.get('state');
  }
  const browser = client(base);
  const state = await start(browser);
  const callback = (code, resultState = state) =>
    callbackPath + '?' + new URLSearchParams({ code, state: resultState });
  assert.equal((await client(base).request(callback('valid'))).headers.get('location'), '/login?oauth=failed');
  assert.equal((await browser.request(callback('valid', 'x'.repeat(43)))).headers.get('location'), '/login?oauth=failed');
  assert.equal(tokenCalls, 0);

  for (const code of ['wrong-nonce', 'wrong-signature']) {
    const nextState = await start(browser);
    const flow = browser.cookies.get('cs_google');
    assert.equal((await browser.request(callback(code, nextState))).headers.get('location'), '/login?oauth=failed');
    browser.cookies.set('cs_google', flow);
    const calls = tokenCalls;
    assert.equal((await browser.request(callback('valid', nextState))).headers.get('location'), '/login?oauth=failed');
    assert.equal(tokenCalls, calls);
  }

  const readyState = await start(browser);
  const result = await browser.request(callback('valid', readyState));
  assert.equal(result.status, 303);
  assert.equal(result.headers.get('location'), '/workspace');
  const account = await (await browser.request('/api/auth/session')).json();
  assert.equal(account.user.role, 'viewer');
  assert.equal(account.user.email, email);
  assert.equal((await browser.request('/api/assets')).status, 200);

  const collision = client(base);
  await collision.request('/api/auth/session');
  email = 'local-account@example.test';
  assert.equal((await collision.request('/api/auth/signup', { method: 'POST', body: { email, password } })).status, 202);
  const external = client(base);
  const collisionState = await start(external);
  assert.equal((await external.request(callback('valid', collisionState))).headers.get('location'), '/login?oauth=failed');
  verified = false;
  email = 'unverified@example.test';
  const unverifiedState = await start(external);
  assert.equal((await external.request(callback('valid', unverifiedState))).headers.get('location'), '/login?oauth=failed');
  assert.equal((await external.request('/api/assets')).status, 401);
  const admin = client(base);
  await login(admin);
  const audit = await (await admin.request('/api/auth/audit/events?kind=auth&limit=100')).json();
  const entries = audit.entries.filter(event => event.action.startsWith('google-'));
  assert.equal(entries.filter(event => event.action === 'google-started').length, 6);
  const success = entries.find(event => event.action === 'google-login' && event.status === 'success');
  assert.equal(success.actor, account.user.email);
  assert.ok(entries.some(event => event.operationId === success.operationId && event.action === 'google-started'));
  assert.equal(entries.filter(event => event.action === 'google-login' && event.status === 'failure').length, 8);
  const exported = JSON.stringify(entries);
  for (const secret of [readyState, unverifiedState, 'wrong-signature', 'wrong-nonce']) assert.ok(!exported.includes(secret));
});
