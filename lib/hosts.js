// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

var oauth2provider = require('oauth2provider');

var db = require('./db');
var log = require('./log');

load();


function load () {

  var hosts = db.get('hosts');

  // Add `localhost` by default.
  if (!hosts.localhost) {
    hosts.localhost = {
      properties: {
        hostname: 'localhost',
        port: '2376'
      }
    };
  }

} // Don't export `load`.


// Get an existing Docker host configuration.

function get (id) {

  var hosts = db.get('hosts');

  return hosts[id || 'localhost'];

}

exports.get = get;


// Create a new Docker host configuration.

function create (id, properties, callback) {

  var hosts = db.get('hosts');

  var host = {
    properties: {
      hostname: properties.hostname || '',
      port: properties.port || ''
    },
    oauth2client: {
      id: '',
      secret: ''
    }
  };

  resetOAuth2Client(host, (error) => {
    callback(error, host);
  });

  hosts[id] = host;
  db.save();

}

exports.create = create;


// Reset a host's OAuth2 client credentials.

function resetOAuth2Client (host, callback) {

  oauth2provider.generateClientCredentials((error, { id, secret }) => {

    if (error) {
      log('oauth2provider client generation error', String(error));
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
