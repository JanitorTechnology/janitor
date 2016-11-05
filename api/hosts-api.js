// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

let selfapi = require('selfapi');

let db = require('../lib/db');
let hosts = require('../lib/hosts');
let users = require('../lib/users');


// API resource to manage Janitor cluster hosts.

let hostsAPI = selfapi({

  title: 'Hosts',

  beforeTests: (callback) => {
    hosts.create('host.name', { port: '2376' }, (error, host) => {
      if (error) {
        callback(error);
        return;
      }
      host.oauth2client.id = '1234';
      host.oauth2client.secret = '123456';
      callback();
    });
  },

  afterTests: (callback) => {
    hosts.destroy('host.name', (error) => {
      callback(error);
    });
  }

});

module.exports = hostsAPI;


hostsAPI.get({

  title: 'List hosts',

  description: 'List all cluster hosts owned by the authenticated user.',

  handler: (request, response) => {
    let user = request.user;
    if (!users.isAdmin(user)) {
      response.statusCode = 403; // Forbidden
      response.json({ error: 'Unauthorized' });
      return;
    }

    let list = [];
    for (let hostname in db.get('hosts')) {
      list.push(hostname);
    }

    response.json(list);
  },

  examples: [{
    response: {
      body: JSON.stringify([ 'host.name' ], null, 2)
    }
  }]

});


// API sub-resource to manage a single cluster host.

let hostAPI = hostsAPI.api('/:hostname');


hostAPI.get({

  title: 'Get a single host',

  handler: (request, response) => {
    let user = request.user;
    if (!users.isAdmin(user)) {
      response.statusCode = 404;
      response.json({ error: 'Host not found' });
      return;
    }

    let host = hosts.get(request.query.hostname);
    if (!host) {
      response.statusCode = 404;
      response.json({ error: 'Host not found' });
      return;
    }

    response.json(host.properties);
  },

  examples: [{
    request: {
      urlParameters: { hostname: 'host.name' }
    },
    response: {
      body: JSON.stringify({ port: '2376' }, null, 2)
    }
  }, {
    request: {
      urlParameters: { hostname: 'unexistant.host.name' }
    },
    response: {
      status: 404,
      body: JSON.stringify({ error: 'Host not found' }, null, 2)
    }
  }]

});
