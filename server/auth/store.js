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
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
  db.exec([
    "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, role TEXT NOT NULL CHECK(role IN ('viewer','admin')), password TEXT, google_sub TEXT UNIQUE, created_at INTEGER NOT NULL)",
    'CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users (id), csrf TEXT NOT NULL, expires_at INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS auth_attempts (bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS oauth_flows (token_hash TEXT PRIMARY KEY, state TEXT NOT NULL, nonce TEXT NOT NULL, verifier TEXT NOT NULL, expires_at INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, kind TEXT NOT NULL, environment TEXT, timestamp TEXT NOT NULL, payload TEXT NOT NULL)',
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
    activity: () => statements.activity.all().map(row => JSON.parse(row.payload)),
    prune(now) {
      statements.clearSessions.run(now);
      statements.clearAttempts.run(now);
      statements.clearFlows.run(now);
    }
  };
}

module.exports = { databasePath, digest, openStore };
