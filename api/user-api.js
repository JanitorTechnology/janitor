// Copyright © 2017 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const jsonpatch = require('fast-json-patch');
const selfapi = require('selfapi');

const configurations = require('../lib/configurations');
const db = require('../lib/db');
const log = require('../lib/log');
const machines = require('../lib/machines');
const users = require('../lib/users');

// API resource to manage a Janitor user.
const userAPI = module.exports = selfapi({
  title: 'User'
});

userAPI.get({
  title: 'Get the authenticated user',

  handler: (request, response) => {
    const { user } = request;
    if (!user) {
      response.statusCode = 403; // Forbidden
      response.json({ error: 'Unauthorized' });
      return;
    }

    response.json(user.profile, null, 2);
  },

  examples: [{
    response: {
      body: JSON.stringify({ name: 'User Name' }, null, 2)
    }
  }]
});

userAPI.patch({
  title: 'Update the authenticated user',
  description: 'Update the user\'s profile information (with JSON Patch).',

  handler: (request, response) => {
    const { user } = request;
    if (!user) {
      response.statusCode = 403; // Forbidden
      response.json({ error: 'Unauthorized' });
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
        response.statusCode = 400; // Bad Request
        response.json({ error: 'Problems parsing JSON' }, null, 2);
        return;
      }

      jsonpatch.apply(user.profile, operations);
      db.save();

      response.json(user.profile, null, 2);
    });
  },

  examples: [{
    request: {
      body: JSON.stringify([
        { op: 'add', path: '/name', value: 'Different Name' }
      ], null, 2)
    },
    response: {
      body: JSON.stringify({ name: 'Different Name' }, null, 2)
    }
  }]
});

// API sub-resource to manage personal configuration files.
const configurationsAPI = userAPI.api('/configurations');

configurationsAPI.get({
  title: 'Get all configuration files',
  handler ({ user }, response) {
    if (!user) {
      response.statusCode = 403; // Forbidden
      response.json({ error: 'Unauthorized' });
      return;
    }

    response.json(user.configurations, null, 2);
  },
  examples: [{
    response: {
      body: JSON.stringify({ '.gitconfig': '' }, null, 2)
    }
  }]
});

configurationsAPI.patch({
  title: 'Update configuration files',
  description: 'Update any of the user\'s configuration file(s) (using JSON Patch).',
  handler (request, response) {
    const { user } = request;
    if (!user) {
      response.statusCode = 403; // Forbidden
      response.json({ error: 'Unauthorized' });
      return;
    }

    let json = '';
    request.on('data', chunk => {
      json += String(chunk);
    });

    request.on('end', () => {
      let operations;
      try {
        operations = JSON.parse(json);
      } catch (error) {
        response.statusCode = 400; // Bad Request
        response.json({ error: 'Problems parsing JSON' });
        return;
      }

      jsonpatch.apply(user.configurations, operations);
      db.save();
      response.json(user.configurations, null, 2);
    });
  },
  examples: [{
    request: {
      body: JSON.stringify([
        { op: 'add', path: '/.gitconfig', value: '[user]\nname = Janitor' }
      ], null, 2)
    },
    response: {
      body: JSON.stringify({ '.gitconfig': '[user]\nname = Janitor'  }, null, 2)
    }
  }]
});

// API sub-resource to manage a single configuration file.
const configurationAPI = configurationsAPI.api('/:configuration');

configurationAPI.delete({
  title: 'Reset a configuration file',
  description: 'Reset a configuration file to its default template value.',
  handler ({ user, query }, response) {
    if (!user) {
      response.statusCode = 403; // Forbidden
      response.json({ error: 'Unauthorized' });
      return;
    }

    configurations.resetToDefault(user, query.configuration, (error) => {
      if (error) {
        response.statusCode = 500; // Internal Server Error
        response.json({ error: 'Could not reset configuration to default' });
        return;
      }

      response.statusCode = 204; // No Content
      response.end();
    });
  },
  examples: [{
    request: {
      urlParameters: {
        configuration: '.gitconfig'
      },
    }
  }]
});

configurationAPI.put({
  title: 'Deploy a configuration file',
  description: 'Overwrite a configuration file in all the user\'s containers (any local changes will be lost!)',
  handler ({ user, query }, response) {
    if (!user) {
      response.statusCode = 403; // Forbidden
      response.json({ error: 'Unauthorized' });
      return;
    }

    const { configuration } = query;
    machines.deployConfigurationFileInAllContainers(user, configuration).then(() => {
      response.statusCode = 204; // No Content
      response.end();
    }).catch(error => {
      response.statusCode = 500; // Internal Server Error
      response.json({ error: 'Could not deploy configuration' });
      log('[fail] could not deploy configuration:', configuration, error);
    });
  },
  request: {
    urlParameters: {
      configuration: '.gitconfig'
    },
  }
});
