// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const crypto = require('crypto');
const oauth = require('oauth');

const db = require('./db');

// Get client access to a given OAuth2 provider.

function getClient (providerId, callback) {

  let providers = db.get('oauth2providers');
  let provider = providers[providerId];

  if (!provider || !provider.id || !provider.secret || !provider.hostname) {
    callback(new Error('OAuth2 provider not set up: ' + providerId));
    return;
  }

  let client = new oauth.OAuth2(
    provider.id,
    provider.secret,
    'https://' + provider.hostname + '/',
    provider.authorizePath || 'login/oauth/authorize',
    provider.accessTokenPath || 'login/oauth/access_token',
    provider.customHeaders || {}
  );

  callback(null, client, provider);
  return;

} // Don't export `getClient`.

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

function getAuthorizationUrl (parameters, callback) {

  let provider = parameters.provider;
  let options = parameters.options || {};

  getClient(provider, (error, client) => {

    if (error) {
      callback(error);
      return;
    }

    let authorizeUrl = client.getAuthorizeUrl(options);
    callback(null, authorizeUrl);
    return;

  });

}

exports.getAuthorizationUrl = getAuthorizationUrl;


// Request an OAuth2 access token in exchange of an OAuth2 autorization code.

function getAccessToken (parameters, callback) {

  let provider = parameters.provider;
  let code = parameters.code;
  let options = parameters.options || {};

  getClient(provider, (error, client) => {

    if (error) {
      callback(error);
      return;
    }

    let onResults = (error, accessToken, refreshToken, results) => {
      if (error) {
        callback(error);
        return;
      }
      if (results.error) {
        callback(results.error);
        return;
      }
      callback(null, accessToken, refreshToken);
      return;
    };

    client.getOAuthAccessToken(code, options, onResults);

  });

}

exports.getAccessToken = getAccessToken;


// Request a new OAuth2 access token using an OAuth2 refresh token.

function refreshAccessToken (parameters, callback) {

  let provider = parameters.provider;
  let refreshToken = parameters.refreshToken;
  let options = parameters.options || {};

  options['grant_type'] = 'refresh_token';

  let refreshParameters = {
    provider: provider,
    code: refreshToken,
    options: options
  };

  getAccessToken(refreshParameters, callback);

}

exports.refreshAccessToken = refreshAccessToken;


// Perform an authenticated request using OAuth2 credentials.

function request (parameters, callback) {

  let providerId = parameters.provider;
  let accessToken = parameters.accessToken;
  let path = parameters.path;
  let data = parameters.data || null;
  let headers = parameters.headers || {};
  let method = parameters.method || 'GET';
  let serviceRequest = parameters.serviceRequest || false;

  getClient(providerId, (error, client, provider) => {

    let api = provider.api || provider.hostname;
    let body = data ? JSON.stringify(data, null, 2) : null;
    let url = 'https://' + api + path;

    if (accessToken) {
      headers['Authorization'] = 'token ' + accessToken;
    } else if (serviceRequest) {
      url += '?client_id=' + provider.id + '&client_secret=' + provider.secret;
    }

    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    let onResponse = (error, data, response) => {
      callback(error, data, response);
      return;
    };

    client._request(method, url, headers, body, null, onResponse);

  });

}

exports.request = request;
