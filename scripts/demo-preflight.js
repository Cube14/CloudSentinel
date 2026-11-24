'use strict';

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const env = process.env;
let blockers = 0;
let warnings = 0;

function report(status, title, detail) {
  if (status === 'BLOCKED') blockers++;
  if (status === 'WARNING') warnings++;
  console.log(status + ' ' + title + ' - ' + detail);
}

function occupied(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(1000);
    for (const [event, result] of [['connect', true], ['error', false], ['timeout', true]]) {
      socket.once(event, () => { socket.destroy(); resolve(result); });
    }
  });
}

function checkDatabase(database) {
  let dir = path.dirname(database);
  while (!fs.existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
  fs.accessSync(dir, fs.constants.W_OK);
  const setup = 'Run npm run setup:admin -- demo-admin@example.test.';
  if (!fs.existsSync(database)) {
    report('BLOCKED', 'SQLite/admin', database + ' is absent. ' + setup);
    return;
  }
  fs.accessSync(database, fs.constants.R_OK | fs.constants.W_OK);
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
    const admins = tables.has('users') ? db.prepare("SELECT count(*) AS count FROM users WHERE role = 'admin'").get().count : 0;
    report(admins ? 'READY' : 'BLOCKED', 'SQLite/admin', database + ' (' + admins + (admins === 1 ? ' admin account).' : ' admin accounts).') + (admins ? '' : ' ' + setup));
    return tables.has('lab_buckets') ? db.prepare('SELECT name FROM lab_buckets').all().map(row => row.name) : [];
  } finally { db.close(); }
}

async function main() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) {
    report('BLOCKED', 'Node', process.version + '. Use Node 22.13+ or Node 24 LTS.');
    return;
  }
  report('READY', 'Node', process.version);
  try {
    for (const name of Object.keys(require('../package.json').dependencies)) require.resolve(name);
    report('READY', 'Dependencies', 'Runtime packages resolve.');
  } catch { report('BLOCKED', 'Dependencies', 'Run npm ci from the repository root.'); }
  const built = fs.existsSync(path.join(root, 'client/dist/index.html'));
  report(built ? 'READY' : 'BLOCKED', 'Frontend', built ? 'Production SPA build is present.' : 'Run npm run build.');
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) report('BLOCKED', 'Node port', 'Set $env:PORT = "3153".');
  else if (await occupied(port)) {
    let healthy = false;
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/api/health',
        { signal: AbortSignal.timeout(2000), redirect: 'error' });
      const health = await response.json();
      healthy = response.ok && health.status === 'ok' && ['local-simulation', 'local-mixed'].includes(health.mode);
    } catch {}
    report(healthy ? 'WARNING' : 'BLOCKED', 'Node port', healthy
      ? 'CloudSentinel already responds on ' + port + '. Reuse it or stop its own terminal before relaunching.'
      : 'Port ' + port + ' is occupied. Run Get-NetTCPConnection -LocalPort ' + port + ' or choose a different PORT.');
  } else report('READY', 'Node port', 'Loopback TCP ' + port + ' is available for launch.');
  report(env.FLOCI_LAB_ENABLED === '1' && env.FLOCI_ENDPOINT === 'http://127.0.0.1:4566' ? 'READY' : 'BLOCKED',
    'Lab settings', 'Require $env:FLOCI_LAB_ENABLED = "1" and $env:FLOCI_ENDPOINT = "http://127.0.0.1:4566".');

  let markers;
  const database = path.resolve(root, env.AUTH_DB_PATH || 'data/cloudsentinel.sqlite');
  try { markers = checkDatabase(database); }
  catch { report('BLOCKED', 'SQLite/admin', 'Check permissions with Get-Acl "' + database + '" or select a writable AUTH_DB_PATH.'); }
  let lab;
  try {
    const { endpoint, openLab } = require('../server/floci-lab');
    lab = openLab({ bucketMarker: name => markers?.includes(name) }, endpoint);
    const { version, buckets } = await lab.list();
    report('READY', 'Floci S3', 'Verified Floci ' + version + ' and a real ListBuckets response at ' + endpoint + '.');
    if (markers) {
      const missing = markers.filter(name => !buckets.some(bucket => bucket.name === name)).length;
      report(missing ? 'WARNING' : 'READY', 'Registrations', (markers.length - missing) +
        ' registered names present, ' + missing + ' absent. Use the Lab to create fresh buckets when needed.');
    }
  } catch {
    report('BLOCKED', 'Floci S3', 'Run docker ps and Invoke-RestMethod http://127.0.0.1:4566/_floci/info. ' +
      'See the pinned startup in docs/professor-demo-v2.md.');
  } finally { lab?.close(); }

  try {
    const { state, model } = await require('../server/investigation').ollamaStatus(env);
    report(state === 'ready' ? 'READY' : 'WARNING', 'Optional Ollama', model + ' is ' + state +
      '. Deterministic investigation remains available. Run ollama list to check installed models.');
  } catch { report('WARNING', 'Optional Ollama', 'Could not check readiness. Run ollama list if needed.'); }

  try {
    const { lanOrigin } = require('../server/lan-proxy').configureBoundary(env);
    report('READY', 'Proxy settings', lanOrigin ? lanOrigin.origin + '. Verify with scripts/test-lan.ps1 after startup.'
      : 'Local HTTP. For LAN setup run .\\scripts\\start-lan.ps1 -Plan.');
  } catch { report('BLOCKED', 'Proxy settings', 'Use scripts/start-lan.ps1 to supply canonical proxy settings.'); }
  if (process.platform === 'win32') {
    try {
      const listener = execFileSync('powershell.exe', ['-NoProfile', '-Command',
        '$p = Get-NetTCPConnection -State Listen -LocalPort 443 -ErrorAction SilentlyContinue; if ($p) { "occupied" }; exit 0'],
      { encoding: 'utf8', timeout: 7000 }).trim();
      if (listener) report('WARNING', 'HTTPS port', 'TCP 443 is occupied. Run Get-NetTCPConnection -State Listen -LocalPort 443.');
    } catch { report('WARNING', 'HTTPS port', 'Check Get-NetTCPConnection -State Listen -LocalPort 443 before starting Caddy.'); }
  }
}

main().catch(error => report('BLOCKED', 'Preflight', error.message)).finally(() => {
  console.log('\n' + (blockers ? 'BLOCKED' : warnings ? 'WARNING' : 'READY') +
    ' (' + blockers + ' blockers, ' + warnings + (warnings === 1 ? ' warning)' : ' warnings)'));
  if (blockers) process.exitCode = 1;
});
