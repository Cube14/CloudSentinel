'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { scan } = require('../security-engine/engine');
const { connector } = require('./connectors/interface');

const providers = ['aws', 'azure', 'gcp'];
const optionalBoolean = value => value === undefined || typeof value === 'boolean';

function fixtureSources(fixtureDir) {
  return providers.map(provider => {
    const id = provider + '-lab';
    return connector({ id, provider, kind: 'fixture', label: provider.toUpperCase() + ' fixture' },
      async () => {
        const raw = await fs.readFile(path.join(fixtureDir, provider + '.json'), 'utf8');
        const data = JSON.parse(raw.replace(/^\uFEFF/, ''));
        if (data.provider !== provider || data.environment !== id || !Array.isArray(data.assets)) {
          throw new Error('Invalid fixture inventory metadata');
        }
        for (const asset of data.assets) {
          const valid = asset?.type === 'storage'
            ? ['public', 'encrypted', 'logging'].every(key => optionalBoolean(asset[key]))
            : asset?.type === 'identity'
              ? (asset.permissions === undefined || (Array.isArray(asset.permissions) &&
                asset.permissions.every(p => typeof p === 'string'))) && optionalBoolean(asset.mfaRequired)
              : asset?.type === 'firewall'
                ? asset.ingress === undefined || (Array.isArray(asset.ingress) &&
                  asset.ingress.every(rule => rule && Number.isInteger(rule.port) && Array.isArray(rule.cidrs) &&
                    rule.cidrs.every(cidr => typeof cidr === 'string')))
                : asset?.type === 'compute' && optionalBoolean(asset.production) &&
                  (asset.publicIp == null || typeof asset.publicIp === 'string');
          if (!valid) throw new Error('Invalid fixture configuration');
        }
        return data.assets;
      });
  });
}

function createScanner(sources) {
  const environments = new Map(sources.map(({ collect, id, provider, kind, label, schedule, endpoint, reason }) => [id, {
    source: { id, provider, kind, label, schedule, endpoint }, collect,
    status: collect ? 'idle' : 'not-connected', connection: collect ? 'configured' : 'not-connected',
    lastAttempt: null, lastSuccess: null, lastSnapshot: null,
    error: reason || null, warnings: [], coverage: null, result: null, inventory: [], resolved: [], history: []
  }]));
  if (environments.size !== sources.length) throw new Error('Duplicate cloud source ID');
  let queue = Promise.resolve();

  function runEnvironment(environment) {
    if (!environment.collect) return;
    if (environment.pending) return environment.pending;
    environment.status = 'queued';
    environment.pending = queue.then(async () => {
      environment.status = 'running';
      environment.lastAttempt = new Date().toISOString();
      environment.error = null;
      try {
        const output = await environment.collect();
        const { assets, state = 'succeeded', warnings = [], error, connection } =
          Array.isArray(output) ? { assets: output } : output;
        environment.warnings = warnings;
        if (state === 'failed' || state === 'not-connected') {
          environment.status = state;
          environment.connection = connection || (state === 'failed' ? 'unavailable' : 'not-connected');
          environment.error = error;
          return;
        }
        if (!['succeeded', 'partial'].includes(state) || !Array.isArray(assets)) throw new Error('Invalid connector result');
        const partial = state === 'partial';
        const { id, provider, kind } = environment.source;
        const resourceKeys = new Set();
        const inventory = assets.map(asset => {
          if (typeof asset?.id !== 'string' || !asset.id || typeof asset.name !== 'string' ||
              !['storage', 'firewall', 'identity', 'compute'].includes(asset.type)) {
            throw new Error('Invalid asset in inventory');
          }
          const key = JSON.stringify([asset.type, asset.id]);
          if (resourceKeys.has(key)) throw new Error('Duplicate asset in inventory');
          resourceKeys.add(key);
          return { ...asset, provider, environment: id, source: kind };
        });
        const result = scan(inventory);
        const previous = new Map([...environment.resolved, ...(environment.result?.findings || [])]
          .map(finding => [finding.id, finding]));
        result.findings = result.findings.map(finding => {
          const existing = previous.get(finding.id);
          previous.delete(finding.id);
          return { ...finding, detectedAt: existing?.detectedAt || result.scannedAt, lastSeenAt: result.scannedAt };
        });
        if (partial) {
          result.findings.push(...[...previous.values()].filter(finding => finding.status === 'OPEN')
            .map(finding => ({ ...finding, stale: true })));
          for (const asset of environment.inventory) {
            if (!resourceKeys.has(JSON.stringify([asset.type, asset.id]))) inventory.push({ ...asset, stale: true });
          }
          result.assets = inventory.length;
          result.score = null;
          for (const severity of Object.keys(result.counts)) {
            result.counts[severity] = result.findings.filter(finding => finding.severity === severity).length;
          }
        }
        environment.resolved = [...previous.values()].flatMap(finding => finding.status === 'RESOLVED'
          ? [finding]
          : partial ? [] : [{ ...finding, stale: undefined, status: 'RESOLVED', resolvedAt: result.scannedAt }]);
        environment.result = result;
        environment.inventory = inventory;
        environment.lastSnapshot = result.scannedAt;
        environment.coverage = partial ? 'partial' : 'complete';
        if (!partial) environment.lastSuccess = result.scannedAt;
        environment.status = state;
        environment.connection = 'connected';
      } catch (error) {
        environment.error = environment.source.kind === 'live' ? 'Live connector could not complete the scan.' : error.message;
        environment.status = 'failed';
        environment.connection = 'unavailable';
      } finally {
        environment.history.unshift({
          startedAt: environment.lastAttempt, finishedAt: new Date().toISOString(),
          status: environment.status, error: environment.error,
          findings: ['succeeded', 'partial'].includes(environment.status) ? environment.result.findings.length : null,
          warnings: environment.warnings
        });
        environment.history.length = Math.min(environment.history.length, 30);
        delete environment.pending;
      }
    });
    queue = environment.pending;
    return queue;
  }

  function selected(id) {
    return id === null ? [...environments.values()] : [environments.get(id)];
  }

  function describe(environment) {
    const { source, status, connection, lastAttempt, lastSuccess, lastSnapshot, error, warnings, coverage, result } = environment;
    return { ...source, status, connection, lastAttempt, lastSuccess, lastSnapshot, error, warnings, coverage,
      scanEnabled: typeof environment.collect === 'function',
      assets: result?.assets ?? null, findings: result?.findings.length ?? null,
      score: result?.score ?? null, counts: result?.counts ?? null };
  }

  return {
    has: id => environments.has(id),
    selected,
    describe,
    run: (id = null) => Promise.all(selected(id).map(runEnvironment)),
    runScheduled: () => Promise.all(selected(null).filter(entry => entry.source.schedule !== false).map(runEnvironment))
  };
}

module.exports = { createScanner, fixtureSources, providers };
