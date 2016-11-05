// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

let oauth2provider = require('oauth2provider');

let db = require('./db');
let log = require('./log');

load();


function load () {

  let hosts = db.get('hosts');

  // Add `localhost` by default.
  if (!hosts.localhost) {
    hosts.localhost = {
      properties: {
        port: '2376',
        ca: '',
        crt: '',
        key: ''
      }
    };
  }

} // Don't export `load`.


// Get an existing Docker host configuration.

function get (hostname) {

  let hosts = db.get('hosts');

  return hosts[hostname || 'localhost'];

}

exports.get = get;


// Find a Docker hostname that matches the given OAuth2 credentials.

function authenticate (clientId, clientSecret) {

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

}

exports.authenticate = authenticate;


// Create a new Docker host configuration.

function create (hostname, properties, callback) {

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

  resetOAuth2ClientSecret(host, (error) => {
    callback(error, host);
  });

  hosts[hostname] = host;
  db.save();

}

exports.create = create;


// Update an existing Docker host configuration.

function update (hostname, properties, callback) {

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

}

exports.update = update;


// Delete an existing Docker host configuration.

function destroy (hostname, callback) {

  let hosts = db.get('hosts');

  if (!hosts[hostname]) {
    callback(new Error('No such host: ' + hostname));
    return;
  }

  delete hosts[hostname];
  db.save();

  callback();

}

exports.destroy = destroy;


// Reset a host's OAuth2 client credentials.

function resetOAuth2ClientSecret (host, callback) {

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
    return;

  });

}

exports.resetOAuth2ClientSecret = resetOAuth2ClientSecret;
