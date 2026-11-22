'use strict';

function localEndpoint(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Expected an HTTP loopback endpoint with no credentials or path');
  }
  return url.origin;
}

module.exports = { localEndpoint };
