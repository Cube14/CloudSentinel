'use strict';

const { timingSafeEqual } = require('node:crypto');
const { isIP } = require('node:net');
const { localEndpoint } = require('./local-endpoint');

const proxyHeaders = ['x-cloudsentinel-proxy', 'x-forwarded-proto', 'x-forwarded-host', 'x-forwarded-for'];
const forwarded = name => name === 'forwarded' || name === 'x-real-ip' ||
  name.startsWith('x-forwarded-') || name.startsWith('x-cloudsentinel-');
const loopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);

function configureBoundary(env) {
  const devOrigin = env.CLIENT_DEV_ORIGIN ? localEndpoint(env.CLIENT_DEV_ORIGIN) : null;
  let lanOrigin;
  let secret;
  if (env.LAN_PROXY !== undefined && !['0', '1'].includes(env.LAN_PROXY)) {
    throw new Error('LAN_PROXY must be 0 or 1');
  }
  if (env.LAN_PROXY === '1') {
    const url = new URL(env.LAN_HTTPS_ORIGIN || 'invalid:');
    if (url.protocol !== 'https:' || url.origin !== env.LAN_HTTPS_ORIGIN ||
        !/^[a-z0-9][a-z0-9.\-]*$/.test(url.hostname)) {
      throw new Error('LAN_HTTPS_ORIGIN must be an exact canonical HTTPS origin (without trailing slash)');
    }
    if (!/^[0-9a-f]{64}$/.test(env.LAN_PROXY_TOKEN || '')) {
      throw new Error('LAN_PROXY_TOKEN must be a random 32-byte token encoded as lowercase hex');
    }
    lanOrigin = url;
    secret = Buffer.from(env.LAN_PROXY_TOKEN, 'hex');
  }

  function request(req, port) {
    if (!loopback(req.socket.remoteAddress)) return null;
    const headers = req.headersDistinct;
    if (headers.host?.length !== 1 || (headers.origin && headers.origin.length !== 1)) return null;
    const [host] = headers.host;
    const origin = headers.origin?.[0];
    const supplied = Object.keys(headers).filter(forwarded);
    if (supplied.length || host === lanOrigin?.host) {
      if (!lanOrigin || host !== lanOrigin.host || supplied.length !== proxyHeaders.length ||
          !proxyHeaders.every(name => headers[name]?.length === 1)) return null;
      const [token] = headers['x-cloudsentinel-proxy'];
      const [ip] = headers['x-forwarded-for'];
      if (!/^[0-9a-f]{64}$/.test(token) || !timingSafeEqual(secret, Buffer.from(token, 'hex')) ||
          headers['x-forwarded-host'][0] !== host || headers['x-forwarded-proto'][0] !== 'https' ||
          !isIP(ip) || (origin !== undefined && origin !== lanOrigin.origin)) return null;
      return { origin: lanOrigin.origin, proxy: { ip } };
    }

    const hosts = ['localhost:' + port, '127.0.0.1:' + port];
    if (port === 80) hosts.push('localhost', '127.0.0.1');
    if (!hosts.includes(host)) return null;
    const direct = new URL('http://' + host).origin;
    if (req.method !== 'GET' && origin && origin !== direct && origin !== devOrigin) return null;
    return { origin: direct, proxy: null };
  }

  return { lanOrigin, request };
}

module.exports = { configureBoundary };
