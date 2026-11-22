'use strict';

const { randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const { normalizeEmail, acceptablePassword, hashPassword, verifyPassword } = require('./password');
const { callbackPath, createGoogle } = require('./google');

const cookieNames = { session: 'cs_session', csrf: 'cs_csrf', google: 'cs_google' };
const tokenPattern = /^[a-zA-Z0-9_-]{43}$/;
const randomToken = () => randomBytes(32).toString('base64url');
const minutes = value => value * 60000;
const authWindow = minutes(10);

function cookie(req, name) {
  const value = req.headers.cookie?.split(';').map(entry => entry.trim())
    .find(entry => entry.startsWith(name + '='))?.slice(name.length + 1);
  return tokenPattern.test(value || '') ? value : null;
}

function setCookie(res, name, value, lifetime, sameSite = 'Strict') {
  res.appendHeader('Set-Cookie', name + '=' + value + '; Path=/; HttpOnly; SameSite=' + sameSite + '; Max-Age=' + lifetime);
}

function publicUser(user) {
  return user ? { id: user.id, email: user.email, role: user.role } : null;
}

function problem(status, message) {
  return Object.assign(new Error(message), { status });
}

function recordAccount(store, action, user) {
  store.addAudit('auth', { id: randomUUID(), action, actor: user?.email || null, timestamp: new Date().toISOString() });
}

function createAuth({ store, env, json, parse, oidcFetch }) {
  const google = createGoogle(env, oidcFetch);
  const sessionSeconds = Number(env.AUTH_SESSION_TTL_SECONDS || 28800);
  if (!Number.isInteger(sessionSeconds) || sessionSeconds < 60 || sessionSeconds > 604800) {
    throw new Error('AUTH_SESSION_TTL_SECONDS must be an integer from 60 to 604800');
  }

  function authenticate(req) {
    return store.readSession(cookie(req, cookieNames.session));
  }

  function checkCsrf(req, user) {
    const expected = user?.csrf || cookie(req, cookieNames.csrf);
    const supplied = req.headers['x-csrf-token'];
    if (!expected || typeof supplied !== 'string' || !tokenPattern.test(supplied) ||
        !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) {
      throw problem(403, 'CSRF validation failed. Refresh and try again.');
    }
  }

  function state(req, res, user) {
    let csrf = user?.csrf || cookie(req, cookieNames.csrf);
    if (!csrf) {
      csrf = randomToken();
      setCookie(res, cookieNames.csrf, csrf, 3600);
    }
    return { csrf, user: publicUser(user), googleEnabled: Boolean(google) };
  }

  function issue(req, user, action) {
    const token = randomToken();
    const csrf = randomToken();
    store.revokeSession(cookie(req, cookieNames.session));
    store.revokeFlow(cookie(req, cookieNames.google));
    store.addSession(token, user.id, csrf, Date.now() + sessionSeconds * 1000);
    recordAccount(store, action, user);
    return { token, csrf, user };
  }

  function sessionResponse(res, { token, csrf, user }) {
    setCookie(res, cookieNames.session, token, sessionSeconds);
    setCookie(res, cookieNames.csrf, '', 0);
    setCookie(res, cookieNames.google, '', 0, 'Lax');
    return { csrf, user: publicUser(user), googleEnabled: Boolean(google) };
  }

  function rate(res, key, max) {
    const now = Date.now();
    const record = store.rate(key, now, authWindow);
    if (record.attempts > max) {
      res.setHeader('Retry-After', String(Math.ceil((record.expires_at - now) / 1000)));
      throw problem(429, 'Too many attempts. Try again later.');
    }
  }

  function redirect(res, location) {
    res.writeHead(303, { Location: location, 'Cache-Control': 'no-store' });
    return res.end();
  }

  async function handle(req, res, url, user) {
    const { pathname } = url;
    const ip = req.socket.remoteAddress;
    if (req.method === 'GET' && pathname === '/api/auth/session') {
      return json(res, 200, state(req, res, user));
    }
    if (req.method === 'GET' && pathname === '/api/auth/audit') {
      if (!user) throw problem(401, 'Sign in required.');
      if (user.role !== 'admin') throw problem(403, 'Administrator access required.');
      return json(res, 200, store.activity());
    }
    if (req.method === 'GET' && pathname === callbackPath) {
      if (!google) throw problem(404, 'Google sign-in is unavailable.');
      const flowToken = cookie(req, cookieNames.google);
      const state = url.searchParams.get('state');
      if (url.origin !== google.origin || !flowToken || !tokenPattern.test(state || '')) {
        return redirect(res, '/login?oauth=failed');
      }
      const flow = store.takeFlow(flowToken, state);
      if (!flow) return redirect(res, '/login?oauth=failed');
      setCookie(res, cookieNames.google, '', 0, 'Lax');
      try {
        const claims = await google.finish(url, flow);
        const email = normalizeEmail(claims?.email);
        const sub = claims?.sub;
        if (!email || claims.email_verified !== true || typeof sub !== 'string' || !sub || sub.length > 255) {
          throw new Error('Google did not return a verified identity');
        }
        const result = store.transaction(() => {
          let account = store.byGoogle(sub);
          if (!account) {
            if (store.byEmail(email)) throw new Error('Email already associated with another sign-in method');
            account = store.createUser(email, 'viewer', null, sub);
          }
          return issue(req, account, 'google-login');
        });
        sessionResponse(res, result);
      } catch {
        return redirect(res, '/login?oauth=failed');
      }
      return redirect(res, '/workspace');
    }
    if (req.method !== 'POST') throw problem(404, 'Not found');
    checkCsrf(req, user);

    if (pathname === '/api/auth/logout') {
      if (!user) throw problem(401, 'Sign in required.');
      store.transaction(() => {
        store.revokeSession(cookie(req, cookieNames.session));
        store.revokeFlow(cookie(req, cookieNames.google));
        recordAccount(store, 'logout', user);
      });
      setCookie(res, cookieNames.session, '', 0);
      setCookie(res, cookieNames.google, '', 0, 'Lax');
      const csrf = randomToken();
      setCookie(res, cookieNames.csrf, csrf, 3600);
      return json(res, 200, { csrf, user: null, googleEnabled: Boolean(google) });
    }

    if (pathname === '/api/auth/google/start') {
      if (!google) throw problem(404, 'Google sign-in is unavailable.');
      if (user) throw problem(409, 'Sign out before continuing with Google.');
      if (url.origin !== google.origin) throw problem(400, 'Open the configured local Google redirect origin to sign in.');
      rate(res, 'google:' + ip, 12);
      const flow = await google.start().catch(() => { throw problem(502, 'Google sign-in is temporarily unavailable.'); });
      const token = randomToken();
      store.transaction(() => {
        store.revokeFlow(cookie(req, cookieNames.google));
        store.addFlow(token, flow.state, flow.nonce, flow.verifier, Date.now() + minutes(5));
      });
      setCookie(res, cookieNames.google, token, 300, 'Lax');
      return json(res, 200, { url: flow.url });
    }

    const signup = pathname === '/api/auth/signup';
    if (!signup && pathname !== '/api/auth/login') throw problem(404, 'Not found');
    rate(res, (signup ? 'signup:' : 'login:') + ip, signup ? 8 : 25);
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
      throw problem(415, 'Send credentials as JSON.');
    }
    const body = await parse(req, 4096);
    const email = normalizeEmail(body.email);
    const password = body.password;
    if (!email || !acceptablePassword(password)) {
      throw problem(signup ? 400 : 401, signup ? 'Enter a valid email and a password of at least 15 characters.' : 'Invalid email or password.');
    }
    if (signup) {
      const hash = await hashPassword(password);
      const result = store.transaction(() => {
        if (store.byEmail(email)) throw problem(409, 'An account with that email already exists.');
        return issue(req, store.createUser(email, 'viewer', hash), 'signup');
      });
      return json(res, 201, sessionResponse(res, result));
    }
    const bucket = 'account:' + email;
    rate(res, bucket, 5);
    const account = store.byEmail(email);
    if (!await verifyPassword(password, account?.password)) {
      throw problem(401, 'Invalid email or password.');
    }
    const result = store.transaction(() => {
      store.clearRate(bucket);
      return issue(req, account, 'password-login');
    });
    return json(res, 200, sessionResponse(res, result));
  }

  return { authenticate, checkCsrf, handle };
}

module.exports = { createAuth, recordAccount };
