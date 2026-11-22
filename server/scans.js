'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { scan } = require('../security-engine/engine');

const providers = ['aws', 'azure', 'gcp'];
const optionalBoolean = value => value === undefined || typeof value === 'boolean';

function fixtureSources(fixtureDir) {
  return providers.map(provider => {
    const id = provider + '-lab';
    return {
      id, provider, kind: 'fixture', label: provider.toUpperCase() + ' fixture',
      async collect() {
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
      }
    };
  });
}

function createScanner(sources) {
  const environments = new Map(sources.map(({ collect, ...source }) => [source.id, {
    source, collect, status: 'idle', lastAttempt: null, lastSuccess: null,
    error: null, result: null, inventory: [], resolved: [], history: []
  }]));
  let queue = Promise.resolve();

  function runEnvironment(environment) {
    if (environment.pending) return environment.pending;
    environment.status = 'queued';
    environment.pending = queue.then(async () => {
      environment.status = 'running';
      environment.lastAttempt = new Date().toISOString();
      environment.error = null;
      try {
        const assets = await environment.collect();
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
        environment.resolved = [...previous.values()].map(finding => finding.status === 'RESOLVED'
          ? finding
          : { ...finding, status: 'RESOLVED', resolvedAt: result.scannedAt });
        environment.result = result;
        environment.inventory = inventory;
        environment.lastSuccess = result.scannedAt;
        environment.status = 'succeeded';
      } catch (error) {
        environment.error = error.message;
        environment.status = 'failed';
      } finally {
        environment.history.unshift({
          startedAt: environment.lastAttempt, finishedAt: new Date().toISOString(),
          status: environment.status, error: environment.error,
          findings: environment.status === 'succeeded' ? environment.result.findings.length : null
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
    const { source, status, lastAttempt, lastSuccess, error, result } = environment;
    return { ...source, status, lastAttempt, lastSuccess, error,
      assets: result?.assets ?? null, findings: result?.findings.length ?? null,
      score: result?.score ?? null, counts: result?.counts ?? null };
  }

  return {
    has: id => environments.has(id),
    selected,
    describe,
    run: (id = null) => Promise.all(selected(id).map(runEnvironment))
  };
}

module.exports = { createScanner, fixtureSources, providers };
