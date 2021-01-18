// Copyright © 2017 Team Janitor. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const selfapi = require('selfapi');

const db = require('../lib/db');
const log = require('../lib/log');
const machines = require('../lib/machines');
const users = require('../lib/users');

// API resource to manage Janitor software projects.
const projectsAPI = module.exports = selfapi({
  title: 'Projects'
});

projectsAPI.get({
  title: 'List projects',
  description:
    'List all the software projects supported by this Janitor instance.',

  handler: (request, response) => {
    const projects = db.get('projects');
    response.json(Object.keys(projects), null, 2);
  },

  examples: [{
    response: {
      body: JSON.stringify(['test-project'], null, 2)
    }
  }]
});

// API sub-resource to manage a single software project.
const projectAPI = projectsAPI.api('/:project');

projectAPI.post('pull', {
  title: 'Pull a project',
  description: 'Trigger a Docker image pull for a given software project.',

  handler: (request, response) => {
    const { user, query } = request;
    // FIXME: Make this API handler accessible to Docker Hub web hooks, so that
    // it's easy to automatically deploy new project images.
    if (!users.isAdmin(user)) {
      response.statusCode = 403; // Forbidden
      response.json({ error: 'Unauthorized' }, null, 2);
      return;
    }

    const projectId = query.project;
    const projects = db.get('projects');
    if (!projects[projectId]) {
      response.statusCode = 404; // Not Found
      response.json({ error: 'Project not found' }, null, 2);
      return;
    }

    machines.pull(projectId, (error, data) => {
      if (error) {
        log('[fail] pulling project', projectId, error);
        response.statusCode = 500; // Internal Server Error
        response.json({ error: 'Could not pull project' }, null, 2);
        return;
      }

      response.json(data, null, 2);
    });
  },

  examples: [{
    request: {
      urlParameters: { project: 'test-project' }
    },
    response: {
      body: JSON.stringify({
        image: 'image:latest',
        created: 1500000000000,
      }, null, 2)
    }
  }]
});
