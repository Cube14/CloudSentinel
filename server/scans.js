'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { scan } = require('../security-engine/engine');
const { randomUUID } = require('node:crypto');
const { record } = require('./audit');
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

function createScanner(sources, store) {
  const environments = new Map(sources.map(({ collect, id, provider, kind, label, schedule, endpoint, reason, identity }) => [id, {
    source: { id, provider, kind, label, schedule, endpoint }, collect,
    status: collect ? 'idle' : 'not-connected', connection: collect ? 'configured' : 'not-connected',
    lastAttempt: null, lastSuccess: null, lastSnapshot: null,
    error: reason || null, warnings: [], coverage: null, result: null, inventory: [], resolved: [], history: [],
    storageKey: JSON.stringify([id, provider, kind, endpoint, identity])
  }]));
  if (environments.size !== sources.length) throw new Error('Duplicate cloud source ID');
  const fields = ['lastAttempt', 'lastSuccess', 'lastSnapshot', 'status', 'connection', 'warnings',
    'coverage', 'error', 'result', 'inventory', 'resolved', 'history'];
  const snapshot = entry => Object.fromEntries(fields.map(key => [key, entry[key]]));
  for (const entry of environments.values()) {
    const saved = entry.collect && store?.readScan(entry.storageKey);
    if (saved) Object.assign(entry, saved);
  }
  let queue = Promise.resolve();
  let stopping = false;

  function runEnvironment(environment, attribution, fresh = false) {
    if (stopping || !environment.collect) return;
    if (environment.pending) return fresh
      ? environment.pending.then(() => runEnvironment(environment, attribution, true))
      : environment.pending;
    environment.status = 'queued';
    environment.pending = queue.then(async () => {
      if (stopping) return;
      const previousState = snapshot(environment);
      const sourceEnvironment = environment.source.id;
      const operationId = randomUUID();
      const scanAudit = (action, status, details) => store && record(store, 'scan', action, status, {
        ...attribution, sourceEnvironment, operationId, details
      });
      let transitions = [];
      environment.status = 'running';
      environment.lastAttempt = new Date().toISOString();
      environment.error = null;
      try {
        scanAudit('scan-started', 'started');
        const output = await environment.collect();
        if (stopping) return;
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
        const transition = (action, finding, details = {}) => transitions.push({
          action, resource: finding.resourceId, details: { findingId: finding.id, ruleId: finding.ruleId, ...details }
        });
        result.findings = result.findings.map(finding => {
          const existing = previous.get(finding.id);
          previous.delete(finding.id);
          if (!existing || existing.status === 'RESOLVED') {
            transition(existing ? 'finding-reopened' : 'finding-opened', finding,
              finding.ruleId === 'S3-001' ? { evidence: finding.evidence } : {});
          }
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
        const currentAssets = new Map(inventory.filter(asset => asset.type === 'storage').map(asset => [asset.id, asset]));
        environment.resolved = [...previous.values()].flatMap(finding => {
          if (finding.status === 'RESOLVED') return [finding];
          if (partial) return [];
          let resolutionEvidence;
          if (finding.ruleId === 'S3-001') {
            const asset = currentAssets.get(finding.resourceId);
            if (asset && asset.publicPolicy !== false) {
              result.findings.push({ ...finding, stale: true });
              result.counts[finding.severity]++;
              result.score = null;
              return [];
            }
            resolutionEvidence = asset ? 'GetBucketPolicyStatus: no public policy' : 'Bucket absent from complete inventory';
          }
          transition('finding-resolved', finding, resolutionEvidence ? { before: finding.evidence, after: resolutionEvidence } : {});
          return [{ ...finding, stale: undefined, status: 'RESOLVED', resolvedAt: result.scannedAt, resolutionEvidence }];
        });
        environment.result = result;
        environment.inventory = inventory;
        environment.lastSnapshot = result.scannedAt;
        environment.coverage = partial ? 'partial' : 'complete';
        if (!partial) environment.lastSuccess = result.scannedAt;
        environment.status = state;
        environment.connection = 'connected';
      } catch (error) {
        transitions = [];
        environment.error = environment.source.kind === 'live' ? 'Live connector could not complete the scan.' : error.message;
        environment.status = 'failed';
        environment.connection = 'unavailable';
      } finally {
        if (stopping) return;
        const history = { operationId,
          startedAt: environment.lastAttempt, finishedAt: new Date().toISOString(),
          status: environment.status, error: environment.error,
          findings: ['succeeded', 'partial'].includes(environment.status) ? environment.result.findings.length : null,
          warnings: environment.warnings
        };
        environment.history = [history, ...environment.history].slice(0, 30);
        try {
          if (store) store.transaction(() => {
            const successful = ['succeeded', 'partial'].includes(environment.status);
            if (successful) for (const entry of transitions.filter(entry => entry.action !== 'finding-resolved')) {
              record(store, 'finding', entry.action, 'observed', { sourceEnvironment, operationId,
                resource: entry.resource, details: entry.details });
            }
            scanAudit(successful ? 'scan-completed' : 'scan-failed', environment.status, {
              coverage: successful ? environment.coverage : null, findings: history.findings
            });
            if (successful) for (const entry of transitions.filter(entry => entry.action === 'finding-resolved')) {
              record(store, 'finding', entry.action, 'observed', { sourceEnvironment, operationId,
                resource: entry.resource, details: entry.details });
            }
            store.saveScan(environment.storageKey, snapshot(environment));
          });
        } catch (error) {
          Object.assign(environment, previousState, { status: 'failed', connection: 'unavailable',
            error: 'Could not persist the scan.' });
          console.error('Could not persist scan:', error.code || error.name);
        } finally {
          delete environment.pending;
        }
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
    run: (id = null, attribution, fresh) => Promise.all(selected(id).map(entry => runEnvironment(entry, attribution, fresh))),
    runScheduled: () => Promise.all(selected(null).filter(entry => entry.source.schedule !== false).map(entry => runEnvironment(entry))),
    stop: () => { stopping = true; }
  };
}

module.exports = { createScanner, fixtureSources, providers };
