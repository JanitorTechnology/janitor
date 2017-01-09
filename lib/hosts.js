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
  let hostname = exports.identify(client_id);
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

  let { user } = request;
  if (!user) {
    callback(new Error('No user to authorize OAuth2 host: ' + hostname));
    return;
  }

  let grant = {
    email: user.email,
    scopes: scope.split(',').map(s => s.trim())
  };

  let onCode = (error, data) => {
    if (error) {
      callback(error);
      return;
    }
    let { code } = data;
    redirect_url += (redirect_url.includes('?') ? '&' : '?') +
      'code=' + encodeURIComponent(code) +
      '&state=' + encodeURIComponent(state);
    callback(null, { code, redirect_url });
  };

  oauth2provider.generateAuthorizationCode(client_id, grant, state, onCode);
};

// Effectively allow a host to make OAuth2 requests on behalf of a user.
exports.issueOAuth2AccessToken = function (request, callback) {
  let { client_id, code, state } = request.query;
  let hostname = exports.identify(client_id);
  if (!hostname) {
    callback(new Error('No such OAuth2 client ID: ' + client_id));
    return;
  }

  let onToken = (error, data) => {
    if (error) {
      callback(error);
      return;
    }

    let { scope: grant, token, tokenHash } = data;
    let authorization = {
      client: client_id,
      date: Date.now(),
      email: grant.email,
      scopes: grant.scopes
    };

    let oauth2tokens = db.get('oauth2tokens');
    if (oauth2tokens[tokenHash]) {
      callback(new Error('OAuth2 token hash already exists: ' + tokenHash));
      return;
    }

    oauth2tokens[tokenHash] = authorization;
    db.save();

    let scope = authorization.scopes.join(',');
    log(hostname, 'was granted access to', scope, 'by', authorization.email);
    callback(null, {
      access_token: token,
      scope: scope
    });
  };

  // Attempt to generate an access token with hash.
  oauth2provider.generateAccessToken(client_id, code, state, onToken);
};
