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

  return hosts[hostname || 'localhost'];
};

// Find a Docker hostname that matches the given OAuth2 credentials.
exports.authenticate = function (clientId, clientSecret) {
  let hosts = db.get('hosts');

  for (let hostname in hosts) {
    let host = hosts[hostname];
    if (!host || !host.oauth2client) {
      continue;
    }
    let { id, secret } = host.oauth2client;
    if (String(clientId) === id && String(clientSecret) === secret) {
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
      log('oauth2provider error', error);
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
