// Copyright © 2017 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const jsonpatch = require('fast-json-patch');
const selfapi = require('selfapi');

const configurations = require('../lib/configurations');
const db = require('../lib/db');
const log = require('../lib/log');
const machines = require('../lib/machines');

// API resource to manage a Janitor user.
const userAPI = module.exports = selfapi({
  title: 'User',

  beforeEachTest: next => {
    const user = db.get('users')['admin@example.com'];
    user.profile.name = 'User';
    next();
  }
});

userAPI.get({
  title: 'Get the authenticated user',

  handler: (request, response) => {
    const { user } = request;
    if (!user) {
      response.statusCode = 403; // Forbidden
      response.json({ error: 'Unauthorized' }, null, 2);
      return;
    }

    response.json(user.profile, null, 2);
  },

  examples: [{
    response: {
      body: JSON.stringify({ name: 'User' }, null, 2)
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
      response.json({ error: 'Unauthorized' }, null, 2);
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

      jsonpatch.applyPatch(user.profile, operations);
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
const configurationsAPI = userAPI.api('/configurations', {
  beforeEachTest: next => {
    const user = db.get('users')['admin@example.com'];
    user.configurations = { '.gitconfig': '[user]\nname = User' };
    next();
  }
});

configurationsAPI.get({
  title: 'Get all user configurations',

  handler ({ user }, response) {
    if (!user) {
      response.statusCode = 403; // Forbidden
      response.json({ error: 'Unauthorized' }, null, 2);
      return;
    }

    response.json(user.configurations, null, 2);
  },

  examples: [{
    response: {
      body: JSON.stringify({ '.gitconfig': '[user]\nname = User' }, null, 2)
    }
  }]
});

configurationsAPI.patch({
  title: 'Update user configurations',
  description: 'Update any user configuration file(s) (using JSON Patch).',

  handler (request, response) {
    const { user } = request;
    if (!user) {
      response.statusCode = 403; // Forbidden
      response.json({ error: 'Unauthorized' }, null, 2);
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
        const changedFiles = operations
          .map(operation => operation.path.replace(/^\//, ''));

        for (const file of changedFiles) {
          if (!configurations.allowed.includes(file)) {
            response.statusCode = 400; // Bad Request
            response.json({
              error: 'Updating ' + file + ' is forbidden'
            }, null, 2);
            return;
          }
        }
      } catch (error) {
        log('[fail] patching user.configurations', error);
        response.statusCode = 400; // Bad Request
        response.json({ error: 'Problems parsing JSON' }, null, 2);
        return;
      }

      jsonpatch.applyPatch(user.configurations, operations);
      db.save();
      response.json(user.configurations, null, 2);
    });
  },

  examples: [{
    request: {
      body: JSON.stringify([
        { op: 'add', path: '/.gitconfig', value: '[user]\nname = Sally' }
      ], null, 2)
    },
    response: {
      body: JSON.stringify({ '.gitconfig': '[user]\nname = Sally' }, null, 2)
    }
  }]
});

// API sub-resource to manage a single configuration file.
const configurationAPI = configurationsAPI.api('/:file');

configurationAPI.delete({
  title: 'Reset a user configuration',
  description: 'Reset a user configuration file to its default template value.',

  handler ({ user, query }, response) {
    if (!user) {
      response.statusCode = 403; // Forbidden
      response.json({ error: 'Unauthorized' }, null, 2);
      return;
    }

    configurations.resetToDefault(user, query.file, error => {
      if (error) {
        response.statusCode = 500; // Internal Server Error
        response.json({ error: 'Could not reset configuration' }, null, 2);
        return;
      }

      response.statusCode = 204; // No Content
      response.end();
    });
  },

  examples: [{
    request: {
      urlParameters: { file: '.gitconfig' },
    },
    response: {
      status: 204
    }
  }]
});

configurationAPI.put({
  title: 'Deploy a user configuration',
  description:
    'Install or overwrite a configuration file in all the user\'s containers ' +
    '(any local changes will be lost!)',

  handler ({ user, query }, response) {
    if (!user) {
      response.statusCode = 403; // Forbidden
      response.json({ error: 'Unauthorized' }, null, 2);
      return;
    }

    const { file } = query;
    machines.deployConfigurationInAllContainers(user, file).then(count => {
      response.json({
        message: 'Successfully deployed to ' + count + ' container' +
          (count === 1 ? '' : 's')
      }, null, 2);
    }).catch(error => {
      log('[fail] could not deploy configuration file:', file, error);
      response.statusCode = 500; // Internal Server Error
      response.json({ error: 'Could not deploy configuration' }, null, 2);
    });
  },

  examples: [{
    request: {
      urlParameters: { file: '.gitconfig' },
    },
    response: {
      body: JSON.stringify({
        message: 'Successfully deployed to 1 container'
      }, null, 2)
    }
  }]
});

// API sub-resource to manage user notifications.
const notificationsAPI = userAPI.api('/notifications', {
  beforeEachTest: next => {
    const user = db.get('users')['admin@example.com'];
    user.notifications.enabled = false;
    next();
  }
});

notificationsAPI.get({
  title: 'Get all user notifications',

  handler (request, response) {
    const { user } = request;
    if (!user) {
      response.statusCode = 403; // Forbidden
      response.json({ error: 'Unauthorized' }, null, 2);
      return;
    }

    response.json(user.notifications.feed.map(({ notification }) => notification), null, 2);
  },

  examples: [{
    response: {
      body: JSON.stringify(
        [], null, 2)
    }
  }]
});

// API sub-resource to enable or disable user notifications.
const notificationsEnabledAPI = notificationsAPI.api('/enabled', {
  beforeEachTest: notificationsAPI.beforeEachTest
});

notificationsEnabledAPI.get({
  title: 'Get the notification settings of the user',

  handler: (request, response) => {
    const { user } = request;
    if (!user) {
      response.statusCode = 403; // Forbidden
      response.json({ error: 'Unauthorized' }, null, 2);
      return;
    }

    response.json({ enabled: user.notifications.enabled }, null, 2);
  },

  examples: [{
    response: {
      body: JSON.stringify({ enabled: false }, null, 2)
    }
  }]
});

notificationsEnabledAPI.put({
  title: 'Enable or disable user notifications',

  handler: (request, response) => {
    const { user } = request;
    if (!user) {
      response.statusCode = 403; // Forbidden
      response.json({ error: 'Unauthorized' }, null, 2);
      return;
    }

    if ('enabled' in request.query) {
      const { enabled } = request.query;
      if (typeof (enabled) !== 'boolean') {
        response.statusCode = 400; // Bad Request
        response.json({ error: 'Parameter \'enabled\' should be "true" or "false"' }, null, 2);
        return;
      }
      user.notifications.enabled = enabled;
      db.save();
      response.json({ enabled }, null, 2);
      return;
    }

    let json = '';
    request.on('data', chunk => {
      json += String(chunk);
    });
    request.on('end', () => {
      try {
        const { enabled } = JSON.parse(json);
        if (typeof (enabled) !== 'boolean') {
          throw new Error('Invalid type for \'enabled\': ' + typeof (enabled));
        }

        user.notifications.enabled = enabled;
        db.save();
        response.json({ enabled: user.notifications.enabled }, null, 2);
      } catch (error) {
        response.statusCode = 400; // Bad Request
        response.json({ error: 'Problems parsing JSON' }, null, 2);
      }
    });
  },

  examples: [{
    request: {
      body: '{ "enabled": true }',
    },
    response: {
      body: JSON.stringify({ enabled: true }, null, 2)
    },
  }, {
    request: {
      queryParameters: { enabled: true }
    },
    response: {
      body: JSON.stringify({ enabled: true }, null, 2)
    },
  }]
});
