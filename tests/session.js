'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const { hashPassword } = require('../server/auth/password');
const { openStore } = require('../server/auth/store');

const password = 'integration tests generated fixture password';
const adminEmail = 'admin@example.test';
let adminHash;

async function seedAdmin(dbPath) {
  adminHash ||= hashPassword(password);
  const hash = await adminHash;
  const store = openStore(dbPath);
  try { store.createUser(adminEmail, 'admin', hash); }
  finally { store.close(); }
}

function client(base) {
  const cookies = new Map();
  let csrf;
  async function request(route, { method = 'GET', body, headers, token = csrf } = {}) {
    const response = await fetch(base + route, {
      method, redirect: 'manual',
      headers: {
        Cookie: [...cookies].map(([name, value]) => name + '=' + value).join('; '),
        ...(method !== 'GET' && token ? { 'X-CSRF-Token': token } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const [name, value] = pair.split('=');
      if (value) cookies.set(name, value);
      else cookies.delete(name);
    }
    if ([200, 201].includes(response.status) && route.startsWith('/api/auth/') &&
        response.headers.get('Content-Type')?.includes('json')) {
      const body = await response.clone().json();
      if (body.csrf) csrf = body.csrf;
    }
    return response;
  }
  return { request, cookies, get csrf() { return csrf; } };
}

async function listen(app) {
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  return 'http://127.0.0.1:' + app.address().port;
}

async function login(browser, email = adminEmail, secret = password) {
  assert.equal((await browser.request('/api/auth/session')).status, 200);
  const response = await browser.request('/api/auth/login', { method: 'POST', body: { email, password: secret } });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

module.exports = { adminEmail, client, listen, login, password, seedAdmin };
