// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

let selfapi = require('selfapi');

let db = require('../lib/db');
let hosts = require('../lib/hosts');
let users = require('../lib/users');


// API resource to manage Janitor cluster hosts.

let hostsAPI = selfapi({
  title: 'Hosts'
});

module.exports = hostsAPI;


hostsAPI.get({

  title: 'List hosts',

  description: 'List all cluster hosts owned by the authenticated user.',

  handler: (request, response) => {

    let user = request.user;
    if (!users.isAdmin(user)) {
      response.json([]);
      return;
    }

    let list = [];
    for (let hostname in db.get('hosts')) {
      list.push(hostname);
    }

    response.json(list);

  },

  examples: []

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

  examples: []

});
