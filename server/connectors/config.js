'use strict';

const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { azureSource, gcpSource } = require('./interface');
const { flociSource } = require('../floci');
const { localEndpoint } = require('../local-endpoint');
const idPattern = /^[a-z][a-z0-9-]{1,47}$/;
const regionPattern = /^(?:us-(?:east|west)|(?:af|ap|ca|eu|il|me|mx|sa)-[a-z]+)-[1-9]$/;
const builders = { aws: config => require('./aws').awsSource(config), azure: azureSource, gcp: gcpSource };

function configuredConnectors(entries, reserved = []) {
  if (!Array.isArray(entries) || entries.length > 32) throw new Error('Cloud source config must be an array of at most 32 entries');
  const ids = new Set(reserved);
  return entries.map((entry, index) => {
    const invalid = message => { throw new Error('Cloud source entry ' + (index + 1) + ': ' + message); };
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) invalid('expected an object');
    const { id, label, provider, kind = 'live', schedule, profile, accountId, regions, endpoint } = entry;
    if (typeof id !== 'string' || !idPattern.test(id) || ids.has(id)) invalid('expected a unique lowercase source ID');
    ids.add(id);
    if (typeof label !== 'string' || !label.trim() || label.length > 80) invalid('expected a label of at most 80 characters');
    if (schedule !== undefined && typeof schedule !== 'boolean') invalid('schedule must be a boolean');
    const base = ['id', 'label', 'provider', 'kind', 'schedule'];
    const config = { id, label: label.trim(), schedule: schedule ?? kind === 'emulator' };
    if (provider === 'aws' && kind === 'emulator') {
      if (Object.keys(entry).some(key => ![...base, 'endpoint'].includes(key))) invalid('unsupported emulator configuration field');
      if (typeof endpoint !== 'string') invalid('a loopback endpoint is required');
      try { localEndpoint(endpoint); } catch { invalid('a valid loopback endpoint is required'); }
      return flociSource(endpoint, config);
    }
    if (kind !== 'live' || !Object.hasOwn(builders, provider)) invalid('unsupported provider or source kind');
    const extra = provider === 'aws' ? ['profile', 'accountId', 'regions'] : [];
    if (Object.keys(entry).some(key => ![...base, ...extra].includes(key))) invalid('unsupported configuration field; keep credentials in the SDK credential chain');
    if (provider !== 'aws') return builders[provider](config);
    if (typeof accountId !== 'string' || !/^\d{12}$/.test(accountId)) invalid('an expected 12-digit AWS account ID is required');
    if (!Array.isArray(regions) || !regions.length || regions.length > 12 ||
        regions.some(region => typeof region !== 'string' || !regionPattern.test(region)) ||
        new Set(regions).size !== regions.length) invalid('provide 1 to 12 unique commercial AWS regions');
    if (profile !== undefined && (typeof profile !== 'string' || !/^[\w.@+-]{1,128}$/.test(profile))) invalid('invalid AWS profile name');
    return builders.aws({ ...config, profile, accountId, regions });
  });
}

function loadConnectors(filename, root, reserved) {
  if (!filename) return [];
  let entries;
  try {
    entries = JSON.parse(readFileSync(resolve(root, filename), 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('CLOUD_SOURCES_FILE must point to a readable JSON source configuration');
  }
  return configuredConnectors(entries, reserved);
}

module.exports = { configuredConnectors, loadConnectors };
