// Copyright © 2017 Team Janitor. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const jsonpatch = require('fast-json-patch');
const selfapi = require('selfapi');

const azure = require('../lib/azure');
const db = require('../lib/db');
const events = require('../lib/events');
const log = require('../lib/log');
const users = require('../lib/users');

// API resource to manage the Janitor instance itself.
const adminAPI = module.exports = selfapi({
  title: 'Admin'
});

// API sub-resource to manage Azure hosting.
const azureAPI = adminAPI.api('/azure');

azureAPI.patch('/credentials', {
  title: 'Update Azure credentials',
  description: 'Update Azure Active Directory application credentials (with JSON Patch).',

  handler: (request, response) => {
    const { user } = request;
    if (!user || !users.isAdmin(user)) {
      response.statusCode = 403; // Forbidden
      response.json({ error: 'Unauthorized' }, null, 2);
      return;
    }

    const { credentials } = db.get('azure');

    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      try {
        const json = Buffer.concat(chunks).toString();
        const operations = JSON.parse(json);
        jsonpatch.applyPatch(credentials, operations, true);
      } catch (error) {
        log('[fail] patching azure credentials', error);
        response.statusCode = 400; // Bad Request
        response.json({ error: 'Invalid JSON Patch' }, null, 2);
        return;
      }

      db.save();
      response.json({ message: 'JSON Patch applied' }, null, 2);
    });
  },

  examples: [{
    request: {
      body: JSON.stringify([
        { op: 'replace', path: '/tenantId', value: '1234-5678' }
      ], null, 2)
    },
    response: {
      body: JSON.stringify({ message: 'JSON Patch applied' }, null, 2)
    }
  }],
});

azureAPI.get('/virtualmachines', {
  title: 'List all virtual machines',
  description: 'List all virtual machines in Azure.',

  handler: async (request, response) => {
    const { user } = request;
    if (!user || !users.isAdmin(user)) {
      response.statusCode = 403; // Forbidden
      response.json({ error: 'Unauthorized' }, null, 2);
      return;
    }

    try {
      const virtualMachines = await azure.getAllVirtualMachines();
      response.json(virtualMachines, null, 2);
    } catch (error) {
      log('[fail] fetching azure virtual machines', error);
      response.statusCode = 500; // Internal Server Error
      response.json({ error: 'Could not fetch virtual machines' }, null, 2);
    }
  },

  examples: [],
});

// API sub-resource to manage scheduled events.
const eventsAPI = adminAPI.api('/events');

eventsAPI.get({
  title: 'List past system events',

  handler: (request, response) => {
    const { user } = request;
    if (!user || !users.isAdmin(user)) {
      response.statusCode = 403; // Forbidden
      response.json({ error: 'Unauthorized' }, null, 2);
      return;
    }

    response.json(events.get(), null, 2);
  },

  examples: [{
    response: {
      body: json => {
        try { return Array.isArray(JSON.parse(json)); } catch (error) { return false; }
      }
    }
  }]
});

eventsAPI.get('/queue', {
  title: 'List upcoming system events',

  handler: (request, response) => {
    const { user } = request;
    if (!user || !users.isAdmin(user)) {
      response.statusCode = 403; // Forbidden
      response.json({ error: 'Unauthorized' }, null, 2);
      return;
    }

    response.json(events.getQueue(), null, 2);
  },

  examples: [{
    response: {
      body: json => {
        try { return Array.isArray(JSON.parse(json)); } catch (error) { return false; }
      }
    }
  }]
});

// API sub-resource to manage OAuth2 providers.
const oauth2providersAPI = adminAPI.api('/oauth2providers', {
  beforeEachTest: next => {
    const providers = db.get('oauth2providers');
    providers.github.id = '1234';
    providers.github.secret = '123456';
    next();
  }
});

oauth2providersAPI.get({
  title: 'List OAuth2 providers',

  handler: (request, response) => {
    const { user } = request;
    if (!user || !users.isAdmin(user)) {
      response.statusCode = 403; // Forbidden
      response.json({ error: 'Unauthorized' }, null, 2);
      return;
    }

    const providers = db.get('oauth2providers');
    response.json(providers, null, 2);
  },

  examples: [{
    response: {
      body: JSON.stringify({
        github: {
          id: '1234',
          secret: '123456',
          hostname: 'github.com',
          api: 'api.github.com'
        }
      }, null, 2)
    }
  }]
});

// API sub-resource to manage a single OAuth2 provider.
const oauth2providerAPI = oauth2providersAPI.api('/:provider', {
  beforeEachTest: oauth2providersAPI.beforeEachTest
});

oauth2providerAPI.patch({
  title: 'Update an OAuth2 provider',
  description: 'Update an OAuth2 provider configuration (with JSON Patch).',

  handler: (request, response) => {
    const { user } = request;
    if (!user || !users.isAdmin(user)) {
      response.statusCode = 403; // Forbidden
      response.json({ error: 'Unauthorized' }, null, 2);
      return;
    }

    const { provider: providerId } = request.query;
    const provider = db.get('oauth2providers')[providerId];
    if (!provider) {
      response.statusCode = 404;
      response.json({ error: 'Provider not found' }, null, 2);
      return;
    }

    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      try {
        const json = Buffer.concat(chunks).toString();
        const operations = JSON.parse(json);
        jsonpatch.applyPatch(provider, operations, true);
      } catch (error) {
        log('[fail] patching oauth2 provider', error);
        response.statusCode = 400; // Bad Request
        response.json({ error: 'Invalid JSON Patch' }, null, 2);
        return;
      }

      db.save();
      response.json(provider, null, 2);
    });
  },

  examples: [{
    request: {
      urlParameters: { provider: 'github' },
      body: JSON.stringify([
        { op: 'add', path: '/secret', value: '654321' },
      ], null, 2),
    },
    response: {
      body: JSON.stringify({
        id: '1234',
        secret: '654321',
        hostname: 'github.com',
        api: 'api.github.com',
      }, null, 2),
    }
  }]
});
