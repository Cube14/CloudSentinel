'use strict';

const { localEndpoint } = require('../local-endpoint');
const callbackPath = '/api/auth/google/callback';

function createGoogle(env, customFetch) {
  const id = env.GOOGLE_CLIENT_ID?.trim();
  const secret = env.GOOGLE_CLIENT_SECRET?.trim();
  const redirect = env.GOOGLE_REDIRECT_URI?.trim();
  if (!id || !secret || !redirect) return null;
  const callback = new URL(redirect);
  localEndpoint(callback.origin);
  if (callback.href !== callback.origin + callbackPath) throw new Error('GOOGLE_REDIRECT_URI must be the local Google callback URL');

  let config;
  async function configuration() {
    if (!config) {
      config = (async () => {
        const oidc = await import('openid-client');
        const client = await oidc.discovery(new URL('https://accounts.google.com'), id, { client_secret: secret },
          oidc.ClientSecretPost(secret), { timeout: 8, ...(customFetch ? { [oidc.customFetch]: customFetch } : {}) });
        oidc.enableNonRepudiationChecks(client);
        return { oidc, client };
      })().catch(error => { config = null; throw error; });
    }
    return config;
  }

  return {
    origin: callback.origin,
    async start() {
      const { oidc, client } = await configuration();
      const verifier = oidc.randomPKCECodeVerifier();
      const state = oidc.randomState();
      const nonce = oidc.randomNonce();
      const url = oidc.buildAuthorizationUrl(client, {
        redirect_uri: callback.href, scope: 'openid email', response_type: 'code',
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: 'S256', state, nonce
      });
      return { url: url.href, state, nonce, verifier };
    },
    async finish(currentUrl, flow) {
      const { oidc, client } = await configuration();
      const tokens = await oidc.authorizationCodeGrant(client, currentUrl, {
        pkceCodeVerifier: flow.verifier, expectedState: flow.state,
        expectedNonce: flow.nonce, idTokenExpected: true
      });
      return tokens.claims();
    }
  };
}

module.exports = { callbackPath, createGoogle };
