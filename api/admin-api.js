// Copyright © 2017 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const jsonpatch = require('fast-json-patch');
const selfapi = require('selfapi');

const db = require('../lib/db');
const log = require('../lib/log');
const users = require('../lib/users');

// API resource to manage the Janitor instance itself.
const adminAPI = module.exports = selfapi({
  title: 'Admin'
});

// API sub-resource to manage OAuth2 providers.
const oauth2providersAPI = adminAPI.api('/oauth2providers', {
  beforeEachTest: next => {
    const providers = db.get('oauth2providers');
    if (!providers.github) {
      // FIXME Remove this if block when the GitHub pull request is merged:
      // https://github.com/JanitorTechnology/janitor/pull/80
      providers.github = {
        id: '',
        secret: '',
        hostname: 'github.com',
        api: 'api.github.com'
      };
    }
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

    let json = '';
    request.on('data', chunk => {
      json += String(chunk);
    });
    request.on('end', () => {
      let operations = null;
      try {
        operations = JSON.parse(json);
      } catch (error) {
        log('[fail] json patch', error);
        response.statusCode = 400; // Bad Request
        response.json({ error: 'Problems parsing JSON' }, null, 2);
        return;
      }

      // Apply the requested changes to the provider.
      jsonpatch.applyPatch(provider, operations);
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
