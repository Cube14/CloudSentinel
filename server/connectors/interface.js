'use strict';

// collect() returns normalized assets and optional coverage warnings. A connector
// without a collector is visible but is never queued.
function connector({ id, provider, kind, label, schedule = true, endpoint, reason, identity }, collect) {
  return { id, provider, kind, label, schedule, endpoint, reason, identity, collect };
}

function azureSource(config) {
  return connector({ ...config, provider: 'azure', kind: 'live',
    reason: 'Azure discovery is not configured. An SDK adapter and authorized credentials are required.' });
}

function gcpSource(config) {
  return connector({ ...config, provider: 'gcp', kind: 'live',
    reason: 'Google Cloud discovery is not configured. An SDK adapter and authorized credentials are required.' });
}

module.exports = { connector, azureSource, gcpSource };
