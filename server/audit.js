'use strict';

const { randomUUID } = require('node:crypto');
const { isIP } = require('node:net');

function client(req, user) {
  const ip = req.lanProxy?.ip || req.socket.remoteAddress;
  return {
    actor: user?.email || null,
    sourceIp: isIP(ip) ? ip.replace(/^::ffff:(?=\d+\.)/, '') : null,
    channel: req.lanProxy ? 'https-proxy' : 'loopback'
  };
}

function record(store, kind, action, status, {
  actor = null, sourceIp = null, channel = 'system', sourceEnvironment = 'local',
  resource = null, operationId = null, details = {}, accountKey
} = {}) {
  const event = { id: randomUUID(), timestamp: new Date().toISOString(), kind, action, status,
    actor, sourceIp, channel, sourceEnvironment, resource, operationId, details, accountKey };
  store.addAudit(kind, event);
  return event;
}

function csv(events) {
  const columns = ['id', 'timestamp', 'kind', 'action', 'status', 'actor', 'sourceIp', 'channel',
    'sourceEnvironment', 'resource', 'operationId', 'details'];
  const cell = value => {
    const string = value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
    return '"' + (/^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/.test(string) ? "'" : '') + string.replaceAll('"', '""') + '"';
  };
  return [columns.join(','), ...events.map(event => columns.map(key => cell(event[key])).join(','))].join('\r\n') + '\r\n';
}

module.exports = { client, record, csv };
