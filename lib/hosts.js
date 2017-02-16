// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

let oauth2provider = require('oauth2provider');

let db = require('./db');
let log = require('./log');

load();

function load () {
  let hostname = db.get('hostname', 'localhost');
  let hosts = db.get('hosts');

  // Add `hostname` by default.
  if (!(hostname in hosts)) {
    hosts[hostname] = {
      properties: {
        port: '2376',
        ca: '',
        crt: '',
        key: ''
      }
    };
  }
}

// Get an existing Docker host configuration.
exports.get = function (hostname) {
  let hosts = db.get('hosts');
  return hosts[hostname || 'localhost'] || null;
};

// Find a Docker hostname that fully matches the request's OAuth2 credentials.
exports.authenticate = function (request) {
  let { client_id = null, client_secret = null } = request.query;
  if (!client_id || !client_secret) {
    return null;
  }

  let hosts = db.get('hosts');
  for (let hostname in hosts) {
    let host = hosts[hostname];
    if (!host || !host.oauth2client || !host.oauth2client.id) {
      continue;
    }
    let { id, secret } = host.oauth2client;
    if (String(client_id) === id && String(client_secret) === secret) {
      return hostname;
    }
  }

  return null;
};

// Find a Docker hostname that matches just the given OAuth2 client ID.
exports.identify = function (clientId) {
  let hosts = db.get('hosts');
  for (let hostname in hosts) {
    let host = hosts[hostname];
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
  let hosts = db.get('hosts');
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
  let hosts = db.get('hosts');
  let host = hosts[hostname];
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
  let hosts = db.get('hosts');
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

    if (!host.oauth2client.id) {
      host.oauth2client.id = id;
    }

    host.oauth2client.secret = secret;
    db.save();

    callback();
  });
};

// Pre-authorize a host to make OAuth2 requests on behalf of a user.
exports.issueOAuth2AuthorizationCode = function (request, callback) {
  let { client_id, scope, state, redirect_url = null } = request.query;
  const hostname = exports.identify(client_id);
  if (!hostname) {
    callback(new Error('No such OAuth2 client ID: ' + client_id));
    return;
  }

  if (!redirect_url) {
    redirect_url = 'https://' + hostname + '/';
  } else if (!redirect_url.startsWith('https://' + hostname + '/')) {
    callback(new Error('Invalid OAuth2 redirect URL: ' + redirect_url));
    return;
  }

  const { user } = request;
  if (!user) {
    callback(new Error('No user to authorize OAuth2 host: ' + hostname));
    return;
  }

  const scopes = parseScopes(scope);
  if (!scopes) {
    callback(new Error('Invalid OAuth2 scope: ' + scope));
    return;
  }

  const grant = { email: user.email, scopes };
  const onCode = (error, data) => {
    if (error) {
      callback(error);
      return;
    }
    const { code } = data;
    redirect_url += (redirect_url.includes('?') ? '&' : '?') +
      'code=' + encodeURIComponent(code) +
      '&state=' + encodeURIComponent(state);
    callback(null, { code, redirect_url });
  };

  oauth2provider.generateAuthorizationCode(client_id, grant, state, onCode);
};

// Effectively allow a host to make OAuth2 requests on behalf of a user.
exports.issueOAuth2AccessToken = function (request, callback) {
  const { client_id, code, state } = request.query;
  const hostname = exports.identify(client_id);
  if (!hostname) {
    callback(new Error('No such OAuth2 client ID: ' + client_id));
    return;
  }

  const onToken = (error, data) => {
    if (error) {
      callback(error);
      return;
    }

    const { scope: grant, token, tokenHash } = data;
    const scope = stringifyScopes(grant.scopes);
    const authorization = {
      client: client_id,
      date: Date.now(),
      email: grant.email,
      scope: scope
    };

    const oauth2tokens = db.get('oauth2tokens');
    if (oauth2tokens[tokenHash]) {
      callback(new Error('OAuth2 token hash already exists: ' + tokenHash));
      return;
    }

    oauth2tokens[tokenHash] = authorization;
    db.save();

    log(hostname, 'was granted access to', scope, 'by', authorization.email);
    callback(null, {
      access_token: token,
      scope: scope
    });
  };

  // Attempt to generate an access token with hash.
  oauth2provider.generateAccessToken(client_id, code, state, onToken);
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
    delete oauth2tokens[tokenHash];
    return null;
  }

  const scopes = parseScopes(scope);
  if (!scopes) {
    // The authorized scope is invalid.
    delete oauth2tokens[tokenHash];
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
