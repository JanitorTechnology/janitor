// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

let selfapi = require('selfapi');

let db = require('../lib/db');
let docker = require('../lib/docker');
let hosts = require('../lib/hosts');
let log = require('../lib/log');
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
    let scope = request.scope;
    let hostname = request.query.hostname;

    if (!hostname) {
      response.statusCode = 400; // Bad Request
      response.json({ error: 'Invalid hostname' });
      return;
    }

    // User or host OAuth2 authentication.
    if (users.isAdmin(user) || scope.hostname === hostname) {
      let host = hosts.get(hostname);
      if (host) {
        response.json(host.properties);
        return;
      }
    }

    response.statusCode = 404;
    response.json({ error: 'Host not found' });
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


hostAPI.get('/credentials', {

  title: 'Show host credentials',

  description: 'Show a host\'s OAuth2 client credentials.',

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

    response.json(host.oauth2client);
  },

  examples: [{
    request: {
      urlParameters: { hostname: 'host.name' }
    },
    response: {
      body: JSON.stringify({ id: '1234', secret: '123456' }, null, 2)
    }
  }]

});


hostAPI.delete('/credentials', {

  title: 'Reset host credentials',

  description: 'Reset a host\'s OAuth2 client secret.',

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

    hosts.resetOAuth2ClientSecret(host, (error) => {
      if (error) {
        response.statusCode = 500; // Internal Server Error
        response.json({ error: 'Could not reset host credentials' });
        return;
      }
      response.json(host.oauth2client);
    });
  },

  examples: [{
    request: {
      urlParameters: { hostname: 'host.name' }
    }
  }]

});


hostAPI.get('/version', {

  title: 'Show host version',

  handler: (request, response) => {
    let user = request.user;
    if (!users.isAdmin(user)) {
      response.statusCode = 404;
      response.json({ error: 'Host not found' });
      return;
    }

    let hostname = request.query.hostname;
    if (!hosts.get(hostname)) {
      response.statusCode = 404;
      response.json({ error: 'Host not found' });
      return;
    }

    docker.version({ host: hostname }, (error, version) => {
      if (error) {
        log('host version', error);
        response.statusCode = 404;
        response.json({ error: 'Host unreachable' });
        return;
      }
      response.json({ docker: version });
    });
  },

  examples: [{
    request: {
      urlParameters: { hostname: 'host.name' }
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
