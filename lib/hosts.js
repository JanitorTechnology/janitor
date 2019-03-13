// Copyright © 2016 Team Janitor. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const oauth2provider = require('oauth2provider');

const db = require('./db');
const log = require('./log');

// Get an existing Docker host configuration.
exports.get = function (hostname) {
  const hosts = db.get('hosts');
  return hosts[hostname] || null;
};

// Find a Docker hostname that fully matches the request's OAuth2 credentials.
exports.authenticate = function (request) {
  const { client_id = null, client_secret = null } = request.query;
  if (!client_id || !client_secret) {
    return null;
  }

  const hosts = db.get('hosts');
  for (const hostname in hosts) {
    const host = hosts[hostname];
    if (!host || !host.oauth2client || !host.oauth2client.id) {
      continue;
    }
    const { id, secret } = host.oauth2client;
    if (String(client_id) === id && String(client_secret) === secret) {
      return hostname;
    }
  }

  return null;
};

// Find a Docker hostname that matches just the given OAuth2 client ID.
exports.identify = function (clientId) {
  const hosts = db.get('hosts');
  for (const hostname in hosts) {
    const host = hosts[hostname];
    if (!host || !host.oauth2client || !host.oauth2client.id) {
      continue;
    }
    if (String(clientId) === host.oauth2client.id) {
      return hostname;
    }
  }

  return null;
};

// Create a new Docker host configuration.
exports.create = function (hostname, properties, callback) {
  const hosts = db.get('hosts');
  let host = hosts[hostname];
  if (host) {
    callback(new Error('Host already exists'), host);
    return;
  }

  host = {
    properties: {
      port: properties.port || '2376',
      ca: properties.ca || '',
      crt: properties.crt || '',
      key: properties.key || ''
    },
    oauth2client: {
      id: '',
      secret: ''
    }
  };

  exports.resetOAuth2ClientSecret(host, (error) => {
    callback(error, host);
  });

  hosts[hostname] = host;
  db.save();
};

// Update an existing Docker host configuration.
exports.update = function (hostname, properties, callback) {
  const hosts = db.get('hosts');
  const host = hosts[hostname];
  if (!host) {
    callback(new Error('No such host: ' + hostname));
    return;
  }

  host.properties = {
    port: properties.port || '2376',
    ca: properties.ca || '',
    crt: properties.crt || '',
    key: properties.key || ''
  };
  db.save();

  callback(null, host);
};

// Delete an existing Docker host configuration.
exports.destroy = function (hostname, callback) {
  const hosts = db.get('hosts');
  if (!hosts[hostname]) {
    callback(new Error('No such host: ' + hostname));
    return;
  }

  delete hosts[hostname];
  db.save();

  callback();
};

// Reset a host's OAuth2 client credentials.
exports.resetOAuth2ClientSecret = function (host, callback) {
  oauth2provider.generateClientCredentials((error, { id, secret }) => {
    if (error) {
      log('[fail] oauth2provider', error);
      callback(error);
      return;
    }

    if (!host.oauth2client) {
      host.oauth2client = {};
    }
    if (!host.oauth2client.id) {
      host.oauth2client.id = id;
    }
    host.oauth2client.secret = secret;
    db.save();

    callback();
  });
};

// Pre-authorize a host to make OAuth2 requests on behalf of a user.
exports.issueOAuth2AuthorizationCode = async function (request) {
  const { client_id, scope, state } = request.query;
  const hostname = exports.identify(client_id);
  if (!hostname) {
    throw new Error('No such OAuth2 client ID: ' + client_id);
  }

  let { redirect_url = null } = request.query;
  if (!redirect_url) {
    redirect_url = 'https://' + hostname + '/';
  } else if (!redirect_url.startsWith('https://' + hostname + '/')) {
    throw new Error('Invalid OAuth2 redirect URL: ' + redirect_url);
  }

  const { user } = request;
  if (!user) {
    throw new Error('No user to authorize OAuth2 host: ' + hostname);
  }

  const scopes = parseScopes(scope);
  if (!scopes) {
    throw new Error('Invalid OAuth2 scope: ' + scope);
  }

  const grant = { email: user._primaryEmail, scopes };
  const data = await new Promise((resolve, reject) => {
    const onCode = (error, data) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(data);
    };

    oauth2provider.generateAuthorizationCode(client_id, grant, state, onCode);
  });

  const { code } = data;
  redirect_url += (redirect_url.includes('?') ? '&' : '?') +
    'code=' + encodeURIComponent(code) +
    '&state=' + encodeURIComponent(state);

  return { code, redirect_url };
};

// Effectively allow a host to make OAuth2 requests on behalf of a user.
exports.issueOAuth2AccessToken = async function (request) {
  const { client_id, code, state } = request.query;
  const hostname = exports.identify(client_id);
  if (!hostname) {
    throw new Error('No such OAuth2 client ID: ' + client_id);
  }

  const data = await new Promise((resolve, reject) => {
    const onToken = (error, data) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(data);
    };

    // Attempt to generate an access token with hash.
    oauth2provider.generateAccessToken(client_id, code, state, onToken);
  });

  const { scope: grant, token, tokenHash } = data;
  const scope = stringifyScopes(grant.scopes);

  const authorization = {
    client: client_id,
    date: Date.now(),
    email: grant.email,
    scope,
  };

  const oauth2tokens = db.get('oauth2tokens');
  if (oauth2tokens[tokenHash]) {
    throw new Error('OAuth2 token hash already exists: ' + tokenHash);
  }

  oauth2tokens[tokenHash] = authorization;
  db.save();

  log(hostname, 'was granted access to', scope, 'by', authorization.email);
  return { access_token: token, scope };
};

// Find the OAuth2 access scope authorized for a request's access token.
exports.getOAuth2Scope = function (request) {
  // Support query parameters like '?access_token=<token>'.
  let token = request.query.access_token || null;
  // Support HTTP headers like 'Authorization: Bearer <token>'.
  if (!token && ('authorization' in request.headers)) {
    token = request.headers.authorization.split(/\s+/)[1];
  }

  if (!token) {
    return null;
  }

  // Verify what the provided token is authorized for.
  const tokenHash = oauth2provider.hash(token);
  const oauth2tokens = db.get('oauth2tokens');
  const authorization = oauth2tokens[tokenHash];
  if (!authorization) {
    return null;
  }

  const { client, email, scope } = authorization;
  const hostname = exports.identify(client);
  if (!hostname) {
    // The authorized OAuth2 client doesn't exist anymore.
    log('[fail] invalid oauth2 client, deleting token:', authorization);
    delete oauth2tokens[tokenHash];
    db.save();
    return null;
  }

  const scopes = parseScopes(scope);
  if (!scopes) {
    // The authorized scope is invalid.
    log('[fail] invalid oauth2 scope, deleting token:', authorization);
    delete oauth2tokens[tokenHash];
    db.save();
    return null;
  }

  return { email, hostname, scopes };
};

// Parse a comma-separated String of OAuth2 scopes into a Set object.
function parseScopes (scope) {
  if (!scope) {
    return null;
  }

  const array = String(scope).split(',').map(item => item.trim());
  const scopes = new Set(array);
  return scopes;
}

// Convert a Set of OAuth2 scopes back into a comma-separated String.
function stringifyScopes (scopes) {
  return Array.from(scopes).join(',');
}
