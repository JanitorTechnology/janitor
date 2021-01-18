// Copyright © 2016 Team Janitor. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const crypto = require('crypto');
const oauth = require('oauth');

const db = require('./db');

// Get client access to a given OAuth2 provider.
function getClient (providerId) {
  const providers = db.get('oauth2providers');
  const provider = providers[providerId];
  if (!provider || !provider.id || !provider.secret || !provider.hostname) {
    throw new Error('OAuth2 provider not set up: ' + providerId);
  }

  const client = new oauth.OAuth2(
    provider.id,
    provider.secret,
    'https://' + provider.hostname + '/',
    provider.authorizePath || 'login/oauth/authorize',
    provider.accessTokenPath || 'login/oauth/access_token',
    provider.customHeaders || {}
  );

  return { client, provider };
}

// Create a new OAuth2 state parameter to protect against CSRF attacks.
exports.generateStateParameter = async function () {
  return new Promise((resolve, reject) => {
    // Generate 20 hex-digits of cryptographically strong pseudo-random data.
    crypto.randomBytes(20 / 2, (error, buffer) => {
      if (error) {
        reject(error);
        return;
      }

      const state = buffer.toString('hex');
      resolve(state);
    });
  });
};

// Get a URL that clients can visit to request an OAuth2 authorization code.
exports.getAuthorizationUrl = async function (parameters) {
  const { provider, options = {} } = parameters;
  const { client } = getClient(provider);
  return client.getAuthorizeUrl(options);
};

// Request an OAuth2 access token in exchange of an OAuth2 autorization code.
exports.getAccessToken = async function (parameters) {
  const { code, provider, options = {} } = parameters;
  const { client } = getClient(provider);

  return new Promise((resolve, reject) => {
    const onResults = (error, accessToken, refreshToken, results) => {
      if (error) {
        reject(error);
        return;
      }

      if (results.error) {
        reject(results.error);
        return;
      }

      resolve({ accessToken, refreshToken });
    };

    client.getOAuthAccessToken(code, options, onResults);
  });
};

// Request a new OAuth2 access token using an OAuth2 refresh token.
exports.refreshAccessToken = async function (parameters) {
  const { provider, refreshToken: code, options = {} } = parameters;
  options.grant_type = 'refresh_token';
  return exports.getAccessToken({ provider, code, options });
};

// Perform an authenticated request using OAuth2 credentials.
exports.request = async function (parameters) {
  const {
    provider: providerId,
    accessToken,
    path,
    data = null,
    headers = {},
    method = 'GET',
    serviceRequest = false
  } = parameters;

  const { client, provider } = getClient(providerId);
  const api = provider.api || provider.hostname;
  const body = data ? JSON.stringify(data, null, 2) : null;
  let url = 'https://' + api + path;

  if (accessToken) {
    headers.Authorization = 'token ' + accessToken;
  } else if (serviceRequest) {
    url += '?client_id=' + provider.id + '&client_secret=' + provider.secret;
  }

  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  return new Promise((resolve, reject) => {
    const onResponse = (error, responseBody, response) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({ body: responseBody, response });
    };

    client._request(method, url, headers, body, null, onResponse);
  });
};
