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

  resetOAuth2Client(host, (error) => {
    callback(error, host);
  });

  hosts[hostname] = host;
  db.save();

}

exports.create = create;


// Reset a host's OAuth2 client credentials.

function resetOAuth2Client (host, callback) {

  oauth2provider.generateClientCredentials((error, { id, secret }) => {

    if (error) {
      log('oauth2provider client generation error', error);
      callback(error);
      return;
    }

    host.oauth2client.id = id;
    host.oauth2client.secret = secret;
    db.save();

    callback(null);
    return;

  });

}

exports.resetOAuth2Client = resetOAuth2Client;
