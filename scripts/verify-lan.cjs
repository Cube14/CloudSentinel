'use strict';

const { readFileSync } = require('node:fs');
const { request } = require('node:https');
const assert = require('node:assert/strict');

async function verify(origin, certificate) {
  const ca = readFileSync(certificate);
  function get(path) {
    return new Promise((resolve, reject) => {
      const incoming = request(new URL(path, origin), { ca, rejectUnauthorized: true }, response => {
        let body = '';
        response.setEncoding('utf8').on('data', data => { body += data; });
        response.on('error', reject);
        response.on('end', () => resolve({ ...response.headers, status: response.statusCode, body }));
      });
      incoming.setTimeout(10000, () => incoming.destroy(new Error('HTTPS verification timed out')));
      incoming.on('error', reject);
      incoming.end();
    });
  }
  const health = await get('/api/health');
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.body).status, 'ok');
  const session = await get('/api/auth/session');
  assert.equal(session.status, 200);
  assert.ok(session['set-cookie']?.some(cookie => /^__Host-cs_csrf=.*; HttpOnly; SameSite=Strict; .*; Secure$/.test(cookie)),
    'Expected a Secure bootstrap cookie');
  const spa = await get('/workspace/overview');
  assert.equal(spa.status, 200);
  assert.match(spa.body, /<div id="root">/);
  console.log('HTTPS certificate, health, Secure bootstrap cookie and SPA route verified at ' + origin);
}

verify(...process.argv.slice(2)).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
