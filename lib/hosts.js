// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

var db = require('./db');
var oauth2 = require('./oauth2');

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

function create (id, properties) {

  var hosts = db.get('hosts');

  var host = {
    properties: {
      hostname: properties.hostname || '',
      port: properties.port || ''
    },
    oauth2client: {}
  };

  hosts[id] = host;

  // Generate oAuth2 client credientials for the new host.
  oauth2.createClient(function (client) {
    host.oauth2client = client;
    db.save();
  });

}

exports.create = create;
