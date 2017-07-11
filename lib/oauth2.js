// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const crypto = require('crypto');
const oauth = require('oauth');

const db = require('./db');
const log = require('./log');

// Get client access to a given OAuth2 provider.
function getClient (providerId, callback) {
  const providers = db.get('oauth2providers');
  const provider = providers[providerId];
  if (!provider || !provider.id || !provider.secret || !provider.hostname) {
    callback(new Error('OAuth2 provider not set up: ' + providerId));
    return;
  }

  const client = new oauth.OAuth2(
    provider.id,
    provider.secret,
    'https://' + provider.hostname + '/',
    provider.authorizePath || 'login/oauth/authorize',
    provider.accessTokenPath || 'login/oauth/access_token',
    provider.customHeaders || {}
  );

  callback(null, client, provider);
}

// Create a new OAuth2 state parameter to protect against CSRF attacks.
exports.generateStateParameter = function (callback) {
  // Generate 20 hex-digits of cryptographically strong pseudo-random data.
  crypto.randomBytes(20 / 2, (error, buffer) => {
    if (error) {
      callback(error);
      return;
    }

    const state = buffer.toString('hex');
    callback(null, state);
  });
};

// Get a URL that clients can visit to request an OAuth2 authorization code.
exports.getAuthorizationUrl = function (parameters, callback) {
  const { provider, options = {} } = parameters;
  getClient(provider, (error, client) => {
    if (error) {
      callback(error);
      return;
    }

    const authorizeUrl = client.getAuthorizeUrl(options);
    callback(null, authorizeUrl);
  });
};

// Request an OAuth2 access token in exchange of an OAuth2 autorization code.
exports.getAccessToken = function (parameters, callback) {
  const { code, provider, options = {} } = parameters;
  getClient(provider, (error, client) => {
    if (error) {
      callback(error);
      return;
    }

    const onResults = (error, accessToken, refreshToken, results) => {
      if (error) {
        callback(error);
        return;
      }

      if (results.error) {
        callback(results.error);
        return;
      }

      callback(null, accessToken, refreshToken);
    };

    client.getOAuthAccessToken(code, options, onResults);
  });
};

// Request a new OAuth2 access token using an OAuth2 refresh token.
exports.refreshAccessToken = function (parameters, callback) {
  const { provider, refreshToken, options = {} } = parameters;
  options['grant_type'] = 'refresh_token';
  exports.getAccessToken({ provider, code: refreshToken, options }, callback);
};

// Perform an authenticated request using OAuth2 credentials.
exports.request = function (parameters, callback) {
  const {
    provider: providerId,
    accessToken,
    path,
    data = null,
    headers = {},
    method = 'GET',
    serviceRequest = false
  } = parameters;

  getClient(providerId, (error, client, provider) => {
    const api = provider.api || provider.hostname;
    const body = data ? JSON.stringify(data, null, 2) : null;
    let url = 'https://' + api + path;

    if (error) {
      log('[fail] could not get the client', error);
    }

    if (accessToken) {
      headers['Authorization'] = 'token ' + accessToken;
    } else if (serviceRequest) {
      url += '?client_id=' + provider.id + '&client_secret=' + provider.secret;
    }

    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const onResponse = (error, responseBody, response) => {
      callback(error, responseBody, response);
    };

    client._request(method, url, headers, body, null, onResponse);
  });
};
