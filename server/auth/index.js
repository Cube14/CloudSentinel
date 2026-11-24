'use strict';

const { randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const { normalizeEmail, acceptablePassword, hashPassword, verifyPassword } = require('./password');
const { client, record, csv } = require('../audit');
const { digest } = require('./store');
const { callbackPath, createGoogle } = require('./google');

const cookieNames = { session: 'cs_session', csrf: 'cs_csrf', google: 'cs_google' };
const tokenPattern = /^[a-zA-Z0-9_-]{43}$/;
const randomToken = () => randomBytes(32).toString('base64url');
const minutes = value => value * 60000;
const authWindow = minutes(10);

function cookie(req, name) {
  if (req.lanProxy) name = '__Host-' + name;
  const value = req.headers.cookie?.split(';').map(entry => entry.trim())
    .find(entry => entry.startsWith(name + '='))?.slice(name.length + 1);
  return tokenPattern.test(value || '') ? value : null;
}

function setCookie(req, res, name, value, lifetime, sameSite = 'Strict') {
  const secure = req.lanProxy ? '; Secure' : '';
  if (req.lanProxy) name = '__Host-' + name;
  res.appendHeader('Set-Cookie', name + '=' + value + '; Path=/; HttpOnly; SameSite=' + sameSite + '; Max-Age=' + lifetime + secure);
}

function publicUser(user) {
  return user ? { id: user.id, email: user.email, role: user.role } : null;
}

function problem(status, message) {
  return Object.assign(new Error(message), { status });
}

function recordAccount(store, action, user) {
  record(store, 'auth', action, 'success', { actor: user?.email, channel: 'terminal' });
}

function createAuth({ store, env, json, parse, oidcFetch, lanOrigin }) {
  const localGoogle = createGoogle(env, oidcFetch);
  const lanGoogle = lanOrigin && env.LAN_GOOGLE_REDIRECT_URI ? createGoogle({
    GOOGLE_CLIENT_ID: env.LAN_GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: env.LAN_GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: env.LAN_GOOGLE_REDIRECT_URI,
  }, oidcFetch, lanOrigin) : null;
  const googleFor = req => req.lanProxy ? lanGoogle : localGoogle;
  if (env.AUTH_SIGNUP_ENABLED !== undefined && !['0', '1'].includes(env.AUTH_SIGNUP_ENABLED)) {
    throw new Error('AUTH_SIGNUP_ENABLED must be 0 or 1.');
  }
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
      setCookie(req, res, cookieNames.csrf, csrf, 3600);
    }
    return { csrf, user: publicUser(user), googleEnabled: Boolean(googleFor(req)) };
  }

  function issue(req, user) {
    const token = randomToken();
    const csrf = randomToken();
    store.revokeSession(cookie(req, cookieNames.session));
    store.revokeFlow(cookie(req, cookieNames.google));
    store.addSession(token, user.id, csrf, Date.now() + sessionSeconds * 1000);
    return { token, csrf, user };
  }

  function sessionResponse(req, res, { token, csrf, user }) {
    setCookie(req, res, cookieNames.session, token, sessionSeconds);
    setCookie(req, res, cookieNames.csrf, '', 0);
    setCookie(req, res, cookieNames.google, '', 0, 'Lax');
    return { csrf, user: publicUser(user), googleEnabled: Boolean(googleFor(req)) };
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
    const ip = req.lanProxy?.ip ?? req.socket.remoteAddress;
    const google = googleFor(req);
    if (req.method === 'GET' && pathname === '/api/auth/session') {
      return json(res, 200, state(req, res, user));
    }
    if (req.method === 'GET' && pathname === '/api/auth/audit') {
      if (!user) throw problem(401, 'Sign in required.');
      if (user.role !== 'admin') throw problem(403, 'Administrator access required.');
      return json(res, 200, store.activity());
    }
    if (req.method === 'GET' && pathname === '/api/auth/audit/events') {
      if (!user) throw problem(401, 'Sign in required.');
      if (user.role !== 'admin') throw problem(403, 'Administrator access required.');
      const exporting = url.searchParams.get('format') === 'csv';
      const events = store.events(url.searchParams, exporting);
      if (!exporting) return json(res, 200, { ...events, metrics: store.metrics() });
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Disposition': 'attachment; filename="cloudsentinel-audit.csv"' });
      return res.end(csv(events.entries));
    }
    const signup = pathname === '/api/auth/signup';
    const login = pathname === '/api/auth/login';
    const googleStart = pathname === '/api/auth/google/start';
    const googleFinish = req.method === 'GET' && pathname === callbackPath;
    const operation = googleStart || googleFinish ? (google ? 'google-login' : 'google-unavailable') : signup ? 'signup' : login ? 'password-login' : null;
    let operationId = randomUUID();
    let accountKey;
    const flowId = token => 'oidc-' + digest('audit-flow:' + token).slice(0, 32);
    const audit = (action, outcome, account, details) => record(store, 'auth', action, outcome, {
      ...client(req, account || user), operationId, accountKey, details
    });
    let attempted = false;
    const attempt = () => {
      if (!login || req.method !== 'POST' || attempted) return;
      audit('password-login-attempted', 'attempted');
      attempted = true;
    };
    try {
      if (googleFinish) {
        if (!google) throw problem(404, 'Google sign-in is unavailable.');
        const flowToken = cookie(req, cookieNames.google);
        if (flowToken) operationId = flowId(flowToken);
        const state = url.searchParams.get('state');
        if (url.origin !== google.origin || !flowToken || !tokenPattern.test(state || '')) {
          audit(operation, 'failure', null, { reason: 'Invalid OAuth flow' });
          return redirect(res, '/login?oauth=failed');
        }
        const flow = store.takeFlow(flowToken, state);
        if (!flow) {
          audit(operation, 'failure', null, { reason: 'Invalid OAuth flow' });
          return redirect(res, '/login?oauth=failed');
        }
        setCookie(req, res, cookieNames.google, '', 0, 'Lax');
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
              if (env.AUTH_SIGNUP_ENABLED === '0') throw new Error('Account registration is disabled.');
              if (store.byEmail(email)) throw new Error('Email already associated with another sign-in method');
              account = store.createUser(email, 'viewer', null, sub);
            }
            const session = issue(req, account);
            audit(operation, 'success', account);
            return session;
          });
          sessionResponse(req, res, result);
        } catch {
          audit(operation, 'failure', null, { reason: 'OAuth exchange or sign-in failed' });
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
          audit('logout', 'success', user);
        });
        setCookie(req, res, cookieNames.session, '', 0);
        setCookie(req, res, cookieNames.google, '', 0, 'Lax');
        const csrf = randomToken();
        setCookie(req, res, cookieNames.csrf, csrf, 3600);
        return json(res, 200, { csrf, user: null, googleEnabled: Boolean(googleFor(req)) });
      }

      if (googleStart) {
        if (!google) throw problem(404, 'Google sign-in is unavailable.');
        if (user) throw problem(409, 'Sign out before continuing with Google.');
        if (url.origin !== google.origin) throw problem(400, 'Open the configured Google redirect origin to sign in.');
        rate(res, 'google:' + ip, 12);
        const flow = await google.start().catch(() => { throw problem(502, 'Google sign-in is temporarily unavailable.'); });
        const token = randomToken();
        operationId = flowId(token);
        store.transaction(() => {
          store.revokeFlow(cookie(req, cookieNames.google));
          store.addFlow(token, flow.state, flow.nonce, flow.verifier, Date.now() + minutes(5));
          audit('google-started', 'started');
        });
        setCookie(req, res, cookieNames.google, token, 300, 'Lax');
        return json(res, 200, { url: flow.url });
      }

      if (!signup && !login) throw problem(404, 'Not found');
      if (signup && env.AUTH_SIGNUP_ENABLED === '0') throw problem(403, 'Account registration is disabled.');
      rate(res, (signup ? 'signup:' : 'login:') + ip, signup ? 8 : 25);
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
        throw problem(415, 'Send credentials as JSON.');
      }
      const body = await parse(req, 4096);
      const email = normalizeEmail(body.email);
      if (email) accountKey = digest('audit-account:' + email);
      attempt();
      const password = body.password;
      if (!email || !acceptablePassword(password)) {
        throw problem(signup ? 400 : 401, signup ? 'Enter a valid email and a password of at least 15 characters.' : 'Invalid email or password.');
      }
      if (signup) {
        const hash = await hashPassword(password);
        store.transaction(() => {
          if (store.byEmail(email)) audit(operation, 'failure', null, { reason: 'Registration unavailable' });
          else audit(operation, 'success', store.createUser(email, 'viewer', hash));
        });
        return json(res, 202, { message: 'You can now continue to sign in.' });
      }
      const bucket = 'account:' + email;
      rate(res, bucket, 5);
      const account = store.byEmail(email);
      if (!await verifyPassword(password, account?.password)) {
        throw problem(401, 'Invalid email or password.');
      }
      const result = store.transaction(() => {
        store.clearRate(bucket);
        const session = issue(req, account);
        audit(operation, 'success', account);
        return session;
      });
      return json(res, 200, sessionResponse(req, res, result));
    } catch (error) {
      attempt();
      if (operation && (req.method === 'POST' || googleFinish)) {
        const code = error.status || (error instanceof SyntaxError ? 400 : 500);
        if (code === 429) audit('rate-limit-triggered', 'blocked', null, { operation });
        audit(operation, 'failure', null, { code });
      }
      throw error;
    }
  }

  return { authenticate, checkCsrf, handle };
}

module.exports = { createAuth, recordAccount };
