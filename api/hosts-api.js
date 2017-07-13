// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const selfapi = require('selfapi');

const db = require('../lib/db');
const docker = require('../lib/docker');
const hosts = require('../lib/hosts');
const log = require('../lib/log');
const machines = require('../lib/machines');
const users = require('../lib/users');

// API resource to manage Janitor cluster hosts.
const hostsAPI = module.exports = selfapi({
  title: 'Hosts'
});

hostsAPI.get({
  title: 'List hosts',
  description: 'List all cluster hosts owned by the authenticated user.',

  handler: (request, response) => {
    const { user } = request;
    if (!users.isAdmin(user)) {
      response.statusCode = 403; // Forbidden
      response.json({ error: 'Unauthorized' }, null, 2);
      return;
    }

    const list = [];
    for (const hostname in db.get('hosts')) {
      list.push(hostname);
    }

    response.json(list, null, 2);
  },

  examples: [{
    response: {
      body: JSON.stringify([ 'example.com' ], null, 2)
    }
  }]
});

// API sub-resource to manage a single cluster host.
const hostAPI = hostsAPI.api('/:hostname', {
  beforeEachTest: next => {
    const host = db.get('hosts')['example.com'];
    if (!host.oauth2client) {
      host.oauth2client = {};
    }
    host.oauth2client.id = '1234';
    host.oauth2client.secret = '123456';
    next();
  }
});

hostAPI.get({
  title: 'Get a single host',

  handler: (request, response) => {
    const { hostname } = request.query;
    if (!hostname) {
      response.statusCode = 400; // Bad Request
      response.json({ error: 'Invalid hostname' }, null, 2);
      return;
    }

    // Host OAuth2 authentication.
    const authenticatedHostname = hosts.authenticate(request);
    if (authenticatedHostname && authenticatedHostname === hostname) {
      const host = hosts.get(hostname);
      if (host) {
        response.json(host.properties, null, 2);
        return;
      }
    }

    // User authentication.
    const { user } = request;
    if (user && users.isAdmin(user)) {
      const host = hosts.get(hostname);
      if (host) {
        response.json(host.properties, null, 2);
        return;
      }
    }

    response.statusCode = 404;
    response.json({ error: 'Host not found' }, null, 2);
  },

  examples: [{
    request: {
      urlParameters: { hostname: 'example.com' }
    },
    response: {
      body: JSON.stringify({ port: '2376', ca: '', crt: '', key: '' }, null, 2)
    }
  }, {
    request: {
      urlParameters: { hostname: 'non-existent.example.com' }
    },
    response: {
      status: 404,
      body: JSON.stringify({ error: 'Host not found' }, null, 2)
    }
  }]
});

hostAPI.post({
  title: 'Create a host',
  description: 'Create a new host and add it to the cluster.',

  handler: (request, response) => {
    const { hostname } = request.query;
    if (!hostname) {
      response.statusCode = 400; // Bad Request
      response.json({ error: 'Invalid hostname' }, null, 2);
      return;
    }

    // Host OAuth2 authentication.
    const authenticatedHostname = hosts.authenticate(request);
    if (authenticatedHostname && authenticatedHostname === hostname) {
      updateHost();
      return;
    }

    // User authentication.
    const { user } = request;
    if (user && users.isAdmin(user)) {
      if (hosts.get(hostname)) {
        updateHost();
        return;
      }
      createHost();
      return;
    }

    // No authentication.
    response.statusCode = 403; // Forbidden
    response.json({ error: 'Unauthorized' }, null, 2);

    function createHost () {
      getHostProperties(properties => {
        hosts.create(hostname, properties, (error, host) => {
          if (error) {
            response.statusCode = 500; // Internal Server Error
            response.json({ error: 'Could not create host' }, null, 2);
            return;
          }
          response.statusCode = 201; // Created
          response.json(host.properties, null, 2);
        });
      });
    }

    function updateHost () {
      getHostProperties(properties => {
        hosts.update(hostname, properties, (error, host) => {
          if (error) {
            response.statusCode = 500; // Internal Server Error
            response.json({ error: 'Could not update host' }, null, 2);
            return;
          }
          response.json(host.properties, null, 2);
        });
      });
    }

    function getHostProperties (callback) {
      if (request.headers['content-type'] !== 'application/json') {
        // If this POST request doesn't contain JSON, assume the data comes in
        // another form (e.g. via query parameters, or as <form> data).
        callback(request.query);
        return;
      }
      let json = '';
      request.on('data', chunk => {
        json += String(chunk);
      });
      request.on('end', () => {
        let parameters = null;
        try {
          parameters = JSON.parse(json);
        } catch (error) {
          response.statusCode = 400; // Bad Request
          response.json({ error: 'Problems parsing JSON' }, null, 2);
          return;
        }
        callback(parameters);
      });
    }
  },

  examples: [{
    request: {
      urlParameters: { hostname: 'example.com' },
      queryParameters: { client_id: '1234', client_secret: '123456' },
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: '2376' }, null, 2)
    }
  }, {
    request: {
      urlParameters: { hostname: 'unauthorized.example.com' },
      queryParameters: { client_id: '1234', client_secret: '123456' },
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: '2345' }, null, 2)
    },
    response: {
      status: 403,
      body: JSON.stringify({ error: 'Unauthorized' }, null, 2)
    }
  }]
});

// API sub-resource to manage a host's OAuth2 credentials.
const credentialsAPI = hostAPI.api('/credentials', {
  beforeEachTest: hostAPI.beforeEachTest
});

credentialsAPI.get({
  title: 'Show host credentials',
  description: 'Show a host\'s OAuth2 client credentials.',

  handler: (request, response) => {
    const { user } = request;
    if (!users.isAdmin(user)) {
      response.statusCode = 404;
      response.json({ error: 'Host not found' }, null, 2);
      return;
    }

    const host = hosts.get(request.query.hostname);
    if (!host) {
      response.statusCode = 404;
      response.json({ error: 'Host not found' }, null, 2);
      return;
    }

    response.json(host.oauth2client, null, 2);
  },

  examples: [{
    request: {
      urlParameters: { hostname: 'example.com' }
    },
    response: {
      body: JSON.stringify({ id: '1234', secret: '123456' }, null, 2)
    }
  }]
});

credentialsAPI.delete({
  title: 'Reset host credentials',
  description: 'Reset a host\'s OAuth2 client secret.',

  handler: (request, response) => {
    const { user } = request;
    if (!users.isAdmin(user)) {
      response.statusCode = 404;
      response.json({ error: 'Host not found' }, null, 2);
      return;
    }

    const host = hosts.get(request.query.hostname);
    if (!host) {
      response.statusCode = 404;
      response.json({ error: 'Host not found' }, null, 2);
      return;
    }

    hosts.resetOAuth2ClientSecret(host, (error) => {
      if (error) {
        response.statusCode = 500; // Internal Server Error
        response.json({ error: 'Could not reset host credentials' }, null, 2);
        return;
      }
      response.json(host.oauth2client, null, 2);
    });
  },

  examples: [{
    request: {
      urlParameters: { hostname: 'example.com' }
    }
  }]
});

hostAPI.get('/version', {
  title: 'Show host version',

  handler: (request, response) => {
    const { user } = request;
    if (!users.isAdmin(user)) {
      response.statusCode = 404;
      response.json({ error: 'Host not found' }, null, 2);
      return;
    }

    const { hostname } = request.query;
    if (!hosts.get(hostname)) {
      response.statusCode = 404;
      response.json({ error: 'Host not found' }, null, 2);
      return;
    }

    docker.version({ host: hostname }, (error, version) => {
      if (error) {
        log('[fail] host version', error);
        response.statusCode = 404;
        response.json({ error: 'Host unreachable' }, null, 2);
        return;
      }
      response.json({ docker: version }, null, 2);
    });
  },

  examples: [{
    request: {
      urlParameters: { hostname: 'example.com' }
    },
    response: {
      body: JSON.stringify({ docker: { Version: '17.06.0-ce' } }, null, 2)
    }
  }, {
    request: {
      urlParameters: { hostname: 'non-existent.example.com' }
    },
    response: {
      status: 404,
      body: JSON.stringify({ error: 'Host not found' }, null, 2)
    }
  }]
});

// API sub-resource to manage a single container on a cluster host.
const containerAPI = hostAPI.api('/:container', {
  title: 'Containers'
});

containerAPI.get('/:port', {
  title: 'Get a single container port',
  description: 'Get information about a given Docker container port.',

  handler: (request, response) => {
    let { user, oauth2scope } = request;
    const { hostname } = request.query;
    if (!user && oauth2scope && oauth2scope.hostname === hostname) {
      const { scopes } = oauth2scope;
      if (scopes.has('user') || scopes.has('user:ports')) {
        user = oauth2scope.user;
      }
    }

    if (!user) {
      response.statusCode = 403; // Forbidden
      response.json({ error: 'Unauthorized' }, null, 2);
      return;
    }

    const { container } = request.query;
    if (container.length < 16 || !/^[0-9a-f]+$/.test(container)) {
      response.statusCode = 400; // Bad Request
      response.json({ error: 'Invalid container ID' }, null, 2);
      return;
    }

    const machine = machines.getMachineByContainer(user, hostname, container);
    if (!machine) {
      response.statusCode = 404;
      response.json({ error: 'Container not found' }, null, 2);
      return;
    }

    const port = String(request.query.port);
    for (const projectPort in machine.docker.ports) {
      if (projectPort === port) {
        response.json(machine.docker.ports[projectPort], null, 2);
        return;
      }
    }

    response.statusCode = 404;
    response.json({ error: 'Port not found' }, null, 2);
  },

  examples: [{
    request: {
      urlParameters: {
        hostname: 'example.com',
        container: 'abcdef0123456789',
        port: '8088'
      }
    },
    response: {
      body: JSON.stringify({
        port: 42001,
        proxy: 'https'
      }, null, 2)
    }
  }]
});
