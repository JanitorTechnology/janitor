// Copyright © 2017 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const jsonpatch = require('fast-json-patch');
const selfapi = require('selfapi');

const db = require('../lib/db');

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
