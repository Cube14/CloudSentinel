'use strict';

const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const digest = value => createHash('sha256').update(value).digest('hex');

function databasePath(env) {
  return path.resolve(root, env.AUTH_DB_PATH || 'data/cloudsentinel.sqlite');
}

function openStore(filename) {
  if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA recursive_triggers = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
  db.exec([
    "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, role TEXT NOT NULL CHECK(role IN ('viewer','admin')), password TEXT, google_sub TEXT UNIQUE, created_at INTEGER NOT NULL)",
    'CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users (id), csrf TEXT NOT NULL, expires_at INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS auth_attempts (bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS oauth_flows (token_hash TEXT PRIMARY KEY, state TEXT NOT NULL, nonce TEXT NOT NULL, verifier TEXT NOT NULL, expires_at INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, kind TEXT NOT NULL, environment TEXT, timestamp TEXT NOT NULL, payload TEXT NOT NULL)',
    'CREATE INDEX IF NOT EXISTS audit_time ON audit (timestamp)',
    "CREATE TRIGGER IF NOT EXISTS audit_append_only_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, 'Audit is append-only'); END",
    "CREATE TRIGGER IF NOT EXISTS audit_append_only_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT, 'Audit is append-only'); END",
    'CREATE TABLE IF NOT EXISTS scan_state (source TEXT PRIMARY KEY, payload TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS lab_locks (name TEXT PRIMARY KEY, operation TEXT NOT NULL, expires INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS lab_buckets (name TEXT PRIMARY KEY, marker TEXT NOT NULL)',
    'CREATE INDEX IF NOT EXISTS audit_scope ON audit (kind, environment, timestamp)',
    'CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions (expires_at)',
    'CREATE INDEX IF NOT EXISTS attempts_expiry ON auth_attempts (expires_at)',
    'CREATE INDEX IF NOT EXISTS flows_expiry ON oauth_flows (expires_at)'
  ].join(';'));
  const statements = {
    email: db.prepare('SELECT * FROM users WHERE email = ?'),
    google: db.prepare('SELECT * FROM users WHERE google_sub = ?'),
    user: db.prepare('INSERT INTO users (id, email, role, password, google_sub, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    session: db.prepare('INSERT INTO sessions (token_hash, user_id, csrf, expires_at) VALUES (?, ?, ?, ?)'),
    readSession: db.prepare('SELECT users.id, users.email, users.role, sessions.csrf FROM sessions JOIN users ON users.id = sessions.user_id WHERE token_hash = ? AND expires_at > ?'),
    removeSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    rate: db.prepare('INSERT INTO auth_attempts VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET attempts = CASE WHEN expires_at <= ? THEN 1 ELSE attempts + 1 END, expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END RETURNING attempts, expires_at'),
    clearRate: db.prepare('DELETE FROM auth_attempts WHERE bucket = ?'),
    flow: db.prepare('INSERT INTO oauth_flows VALUES (?, ?, ?, ?, ?)'),
    takeFlow: db.prepare('DELETE FROM oauth_flows WHERE token_hash = ? AND state = ? AND expires_at > ? RETURNING state, nonce, verifier'),
    removeFlow: db.prepare('DELETE FROM oauth_flows WHERE token_hash = ?'),
    audit: db.prepare('INSERT INTO audit VALUES (?, ?, ?, ?, ?)'),
    listAudit: db.prepare('SELECT payload FROM audit WHERE kind = ? ORDER BY timestamp, rowid'),
    scopedAudit: db.prepare('SELECT payload FROM audit WHERE kind = ? AND environment = ? ORDER BY timestamp, rowid'),
    activity: db.prepare("SELECT payload FROM audit WHERE kind = 'auth' ORDER BY timestamp DESC, rowid DESC LIMIT 100"),
    clearSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    clearAttempts: db.prepare('DELETE FROM auth_attempts WHERE expires_at <= ?'),
    clearFlows: db.prepare('DELETE FROM oauth_flows WHERE expires_at <= ?')
  };

  const action = "json_extract(payload, '$.action')";
  const status = "COALESCE(json_extract(payload, '$.status'), CASE WHEN kind = 'auth' THEN 'success' END)";
  const metrics = db.prepare(`SELECT
    count(*) FILTER (WHERE ${action} = 'password-login-attempted' OR (${action} = 'password-login' AND json_extract(payload, '$.operationId') IS NULL)) AS attempts,
    count(*) FILTER (WHERE ${action} = 'password-login' AND ${status} = 'success') AS successes,
    count(*) FILTER (WHERE ${action} = 'password-login' AND ${status} = 'failure') AS failures,
    count(*) FILTER (WHERE ${action} = 'rate-limit-triggered' AND json_extract(payload, '$.details.operation') = 'password-login') AS blocked,
    count(*) FILTER (WHERE ${action} IN ('google-started', 'google-login') AND
      COALESCE(json_extract(payload, '$.details.code'), 0) <> 404) AS oauth,
    max(timestamp) FILTER (WHERE ${action} IN ('password-login', 'google-login') AND ${status} = 'success') AS lastLogin
    FROM audit WHERE kind = 'auth'`);
  const failedByDay = db.prepare(`WITH RECURSIVE days(day) AS (
    SELECT date('now', '-13 days') UNION ALL SELECT date(day, '+1 day') FROM days WHERE day < date('now')
  ), failures AS (
    SELECT substr(timestamp, 1, 10) AS day, count(*) AS count FROM audit
    WHERE kind = 'auth' AND ${action} = 'password-login' AND ${status} = 'failure'
    AND timestamp >= date('now', '-13 days') GROUP BY day
  ) SELECT days.day, COALESCE(failures.count, 0) AS count FROM days LEFT JOIN failures USING (day) ORDER BY days.day`);
  const scanState = db.prepare('SELECT payload FROM scan_state WHERE source = ?');
  const saveScan = db.prepare('INSERT INTO scan_state VALUES (?, ?) ON CONFLICT(source) DO UPDATE SET payload = excluded.payload');
  const bucket = db.prepare('SELECT marker FROM lab_buckets WHERE name = ?');
  const acquireBucket = db.prepare('INSERT INTO lab_locks VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET operation = excluded.operation, expires = excluded.expires WHERE expires <= ?');
  const releaseBucket = db.prepare('DELETE FROM lab_locks WHERE name = ? AND operation = ?');
  const approveBucket = db.prepare('INSERT INTO lab_buckets VALUES (?, ?)');

  const auditWatermark = db.prepare('SELECT COALESCE(max(rowid), 0) AS value FROM audit');

  function events(params, exportAll) {
    const current = auditWatermark.get().value;
    const requested = params.has('through') && /^\d+$/.test(params.get('through')) ? Number(params.get('through')) : current;
    const through = Math.min(requested, current);
    const clauses = ['rowid <= ?'], values = [through];
    for (const [key, column] of Object.entries({ kind: 'kind', action, status, environment: "COALESCE(environment, 'local')",
      operation: "json_extract(payload, '$.operationId')" })) {
      const value = params.get(key)?.trim().slice(0, 128);
      if (value) { clauses.push(column + ' = ?'); values.push(value); }
    }
    const dates = ['from', 'before'].map(key => params.get(key));
    for (const [index, date] of dates.entries()) {
      if (date === null) continue;
      const parsed = new Date(date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) ||
          parsed.toISOString().slice(0, 10) !== date || (dates[0] && dates[1] && dates[0] >= dates[1])) {
        throw Object.assign(new Error('Use an ordered UTC date range in YYYY-MM-DD format.'), { status: 400 });
      }
      clauses.push(index === 0 ? 'timestamp >= ?' : 'timestamp < ?');
      values.push(date);
    }
    const search = params.get('q')?.trim().toLowerCase().slice(0, 254);
    if (search) {
      clauses.push(`(instr(lower(id || ' ' || ${action} || ' ' || coalesce(json_extract(payload, '$.actor'), json_extract(payload, '$.approvedBy'), '') ||
        ' ' || coalesce(json_extract(payload, '$.resource'), json_extract(payload, '$.incidentId'), '') ||
        ' ' || coalesce(json_extract(payload, '$.details.findingId'), '')), ?) > 0
        OR json_extract(payload, '$.accountKey') = ?)`);
      values.push(search, digest('audit-account:' + search));
    }
    const where = ' WHERE ' + clauses.join(' AND ');
    const pageSize = Math.max(1, Math.min(100, Number.parseInt(params.get('limit'), 10) || 25));
    const page = Math.max(1, Math.min(10000000, Number.parseInt(params.get('page'), 10) || 1));
    const total = db.prepare('SELECT count(*) AS total FROM audit' + where).get(...values).total;
    if (exportAll && total > 10000) {
      throw Object.assign(new Error('Narrow the audit date range or filters to export at most 10,000 events.'), { status: 413 });
    }
    const rows = db.prepare('SELECT kind, payload FROM audit' + where + ' ORDER BY timestamp DESC, rowid DESC' +
      (exportAll ? '' : ' LIMIT ? OFFSET ?')).all(...values, ...(exportAll ? [] : [pageSize, (page - 1) * pageSize]));
    const entries = rows.map(row => {
      const { accountKey, ...event } = JSON.parse(row.payload);
      return { kind: row.kind, status: row.kind === 'auth' ? 'success' : null,
        actor: event.approvedBy ?? null, sourceEnvironment: 'local', resource: event.incidentId ?? null, ...event };
    });
    return { entries, total, page, pageSize, through };
  }

  function transaction(callback) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = callback();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  return {
    close: () => db.close(),
    transaction,
    events,
    metrics: () => ({ ...metrics.get(), failedByDay: failedByDay.all() }),
    readScan: source => JSON.parse(scanState.get(source)?.payload || 'null'),
    saveScan: (source, state) => saveScan.run(source, JSON.stringify(state)),
    bucketMarker: name => bucket.get(name)?.marker,
    approveBucket: (name, marker) => approveBucket.run(name, marker),
    lockBucket: (name, operation, now) => acquireBucket.run(name, operation, now + 120000, now).changes === 1,
    unlockBucket: (name, operation) => releaseBucket.run(name, operation),
    byEmail: email => statements.email.get(email),
    byGoogle: sub => statements.google.get(sub),
    createUser(email, role, password, googleSub = null) {
      const id = randomUUID();
      statements.user.run(id, email, role, password, googleSub, Date.now());
      return { id, email, role };
    },
    readSession: token => token ? statements.readSession.get(digest(token), Date.now()) : null,
    addSession: (token, userId, csrf, expiry) => statements.session.run(digest(token), userId, csrf, expiry),
    revokeSession: token => { if (token) statements.removeSession.run(digest(token)); },
    rate: (key, now, window) => statements.rate.get(digest(key), now + window, now, now),
    clearRate: key => statements.clearRate.run(digest(key)),
    addFlow: (token, state, nonce, verifier, expiry) => statements.flow.run(digest(token), state, nonce, verifier, expiry),
    takeFlow: (token, state) => statements.takeFlow.get(digest(token), state, Date.now()),
    revokeFlow: token => { if (token) statements.removeFlow.run(digest(token)); },
    addAudit(kind, payload) {
      statements.audit.run(payload.id, kind, payload.sourceEnvironment || null, payload.timestamp, JSON.stringify(payload));
    },
    audit(environment = null) {
      const rows = environment === null ? statements.listAudit.all('response') : statements.scopedAudit.all('response', environment);
      return rows.map(row => JSON.parse(row.payload));
    },
    activity: () => statements.activity.all().map(row => {
      const { accountKey, ...event } = JSON.parse(row.payload);
      return event;
    }),
    prune(now) {
      statements.clearSessions.run(now);
      statements.clearAttempts.run(now);
      statements.clearFlows.run(now);
    }
  };
}

module.exports = { databasePath, digest, openStore };
