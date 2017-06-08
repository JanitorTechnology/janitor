// Copyright © 2017 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const jsonpatch = require('fast-json-patch');
const selfapi = require('selfapi');

const configurations = require('../lib/configurations');
const db = require('../lib/db');
const machines = require('../lib/machines');
const users = require('../lib/users');

// API resource to manage a Janitor user.
const userAPI = module.exports = selfapi({
  title: 'User',
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

var configAPI = userAPI.api("/configurations");
configAPI.get({
  handler({ user }, response) {
    if (!user.hasOwnProperty("configurations")) {
       response.statusCode = 404;
       response.json({ error: "Configurations do not exist" });
       return;
    }

    response.json(user.configurations);
  },
  examples: [{
    response: {
      body: JSON.stringify({
        '.gitconfig': ''
      }, null, 2)
    }
  }]
});

configAPI.patch({
  handler(request, response) {
    let { user } = request;
    if (!user) {
      response.statusCode = 403; // Forbidden
      response.json({ error: 'Unauthorized' });
      return;
    }

    if (!user.configurations) {
      user.configurations = {};
    }

    let str = '';
    request.on('data', chunk => {
      str += String(chunk);
    });

    request.on('end', () => {
      let json;
      try {
        json = JSON.parse(str);
      } catch (e) {
        response.statusCode = 400;
        response.json({error: "JSON incorrect"});
        return;
      }
      jsonpatch.apply(user.configurations, json);
      db.save();
      response.json({status: "OK"});
    });
  },
  examples: [{
    request: {
      urlParameters: {
        config: '.gitconfig',
      },

      body: '[user]\nname = Janitor'
    },
    response: '[user]\nname = Janitor',
  }]
});

configAPI.delete("/:configuration", {
  handler(request, response) {
    console.log("ok");
    let { user, query } = request;
    if (!user) {
      response.statusCode = 403;
      response.json('User not found');
      return;
    }

    configurations.resetConfiguration(user, query.configuration);
    response.json({status: 'OK'});
  },
});

configAPI.put("/:configuration", {
  handler(request, response) {
    let { user, query } = request;
    if (!user) {
      response.statusCode = 403;
      response.json('User not found');
      return;
    }

    let userMachines = Object.values(user.machines)
      .reduce((acc, val) => acc.concat(val), []);

    let promises = Promise.all(userMachines.map((machine) =>
      new Promise((resolve) =>
        machines.resetConfigurationFile(user, query.configuration, machine, resolve))
    ));

    promises.then(() => {
      response.json({ status: "done" });
    }).catch((e) => {
      response.json({ error: e });
    });
  }
})