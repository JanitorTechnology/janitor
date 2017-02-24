// Copyright © 2015 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const crypto = require('crypto');
const jsonpatch = require('fast-json-patch');

const db = require('./db');
const docker = require('./docker');
const log = require('./log');
const metrics = require('./metrics');
const streams = require('./streams');

// List available user machines for each project, create when necessary.
exports.getAvailableMachines = function (user) {
  const machines = {};
  for (const projectId in db.get('projects')) {
    machines[projectId] = getMachine(user, projectId);
  }

  return machines;
};

// Get an existing user machine with the given project and machine ID.
exports.getMachineById = function (user, projectId, machineId) {
  const machines = user.machines[projectId];
  if (!machines) {
    return null;
  }

  return machines[machineId] || null;
};

// Get an existing user machine with the given hostname and container ID.
exports.getMachineByContainer = function (user, hostname, containerId) {
  if (containerId.length < 16) {
    log(new Error('Container ID too short: ' + containerId +
      ' (while getting a machine for ' + user.email + ')'));
    return null;
  }

  for (const projectId in user.machines) {
    for (const machine of user.machines[projectId]) {
      if (machine.docker.host === hostname &&
        machine.docker.container.startsWith(containerId)) {
        return machine;
      }
    }
  }

  return null;
};

// Change the parameters of an existing project, or create a new project.
exports.setProject = function (parameters) {
  // Find the project with this ID, create it if necessary.
  const project = getProject(parameters.id, true);

  // Extract parameters that look like JSON Patch operations (RFC 6902).
  const operations = [];
  for (const name in parameters) {
    if (name[0] !== '/') {
      continue;
    }

    operations.push({
      op: 'add',
      path: name,
      value: parameters[name]
    });
  }

  // Apply the requested changes to the project.
  jsonpatch.apply(project, operations);
  db.save();
};

// Rebuild the base image of a project. (Slow)
exports.rebuild = function (projectId, callback) {
  const project = getProject(projectId);
  if (!project) {
    callback(new Error('Unknown project: ' + projectId));
    return;
  }

  const { host, image, build: dockerfile } = project.docker;
  const tag = image + ':base';
  const time = Date.now();

  docker.buildImage({ host, tag, dockerfile }, (error, stream) => {
    if (error) {
      log ('rebuild', image, error);
      callback(new Error('Unable to rebuild project: ' + projectId));
      return;
    }

    log('rebuild', image, 'started');

    streams.set(project.docker, 'logs', stream);

    stream.on('error', err => {
      log('rebuild', image, err);
      error = err;
    });

    stream.on('end', () => {
      if (error) {
        log('rebuild', image, error);
        callback(new Error('Problem while rebuilding project: ' + projectId));
        return;
      }

      log('rebuild', image, 'success');
      const now = Date.now();
      metrics.set(project, 'updated', now);
      metrics.push(project, 'build-time', [ now, now - time ]);
      callback();
    });
  });
};

// Update the base image of a project.
exports.update = function (projectId, callback) {
  const project = getProject(projectId);
  if (!project) {
    callback(new Error('Unknown project: ' + projectId));
    return;
  }

  const { host, image, update: dockerfile } = project.docker;
  const tag = image + ':latest';
  const time = Date.now();

  docker.buildImage({ host, tag, dockerfile }, (error, stream) => {
    if (error) {
      log('update', image, error);
      callback(new Error('Unable to update project: ' + projectId));
      return;
    }

    log('update', image, 'started');

    streams.set(project.docker, 'logs', stream);

    stream.on('error', err => {
      log('update', image, err);
      error = err;
    });

    stream.on('end', () => {
      if (error) {
        log('update', image, error);
        callback(new Error('Problem while updating project: ' + projectId));
        return;
      }

      log('update', image, 'success');
      const now = Date.now();
      metrics.set(project, 'updated', now);
      metrics.push(project, 'update-time', [ now, now - time ]);
      callback();
    });
  });
};

// Instantiate a user machine for a project. (Fast!)
exports.spawn = function (user, projectId, callback) {
  const project = getProject(projectId);
  if (!project) {
    callback(new Error('Unknown project: ' + projectId));
    return;
  }

  let machine = getMachine(user, projectId);
  let host = project.docker.host;
  let image = project.docker.image;
  let dockerfile = project.docker.spawn;
  let time = Date.now();

  // Don't re-spawn a machine that's already started.
  if (machine.status === 'started') {
    return callback(null, machine.docker.logs);
  }

  // Template the user's Cloud9 key into the spawning rules.
  dockerfile = dockerfile.replace(/%CLOUD9_KEY%/g, user.keys.cloud9);

  // Compute a unique tag for this intermediary image.
  var tag = hash(user.email + ' ' + projectId + ' ' + machine.id);

  let parameters = {
    host: host,
    tag: tag,
    dockerfile: dockerfile
  };

  docker.buildImage(parameters, function (error, stream) {

    if (error) {
      log('spawn', image, error);
      machine.status = 'build-failed';
      db.save();
      return callback(error);
    }

    log('spawn', image, 'started');
    machine.docker.image = tag;
    machine.status = 'build-started';
    streams.set(machine.docker, 'logs', stream);

    stream.on('error', (err) => {
      log('spawn', image, err);
      machine.status = 'build-failed';
      error = err;
    });

    stream.on('end', () => {
      if (error) {
        db.save();
        callback(error);
        return;
      }

      machine.status = 'built';

      let parameters = {
        host: host,
        image: tag,
        ports: {}
      };

      // Specify which ports should be exposed publicly or kept private.
      for (let projectPort in machine.docker.ports) {
        let { port, proxy } = machine.docker.ports[projectPort];
        parameters.ports[projectPort] = {
          hostPort: port,
          publish: (proxy === 'none')
        };
      }

      docker.runContainer(parameters, (error, container) => {
        if (error) {
          log('spawn', image, error);
          machine.status = 'start-failed';
          db.save();
          callback(error);
          return;
        }

        log('spawn', image, 'success');
        machine.docker.container = container.id;
        machine.status = 'started';

        let now = Date.now();
        metrics.push(project, 'spawn-time', [ now, now - time ]);

        // Keep track of the last project update this machine is based on.
        metrics.set(machine, 'updated', project.data.updated);

        db.save();
        return callback(error);
      });

    });

  });
};

// Destroy a given user machine and recycle its ports.
exports.destroy = function (user, projectId, machineId, callback) {
  const machines = user.machines[projectId];
  if (!machines) {
    callback(new Error('No machines for project: ' + projectId));
    return;
  }

  const machine = machines[machineId];
  if (!machine || machine.status === 'new') {
    // If there is no instantiated machine to destroy, do nothing.
    callback();
    return;
  }

  const { container: containerId, host } = machine.docker;
  if (!containerId) {
    // This machine has no associated container, just recycle it as is.
    machine.status = 'new';
    db.save();
    callback();
    return;
  }

  log('destroy', containerId.slice(0, 16), 'started');
  docker.removeContainer({ host, container: containerId }, error => {
    if (error) {
      log('destroy', containerId.slice(0, 16), error);
      callback(error);
      return;
    }

    // Recycle the machine's name and ports.
    machine.status = 'new';
    machine.docker.container = '';
    db.save();
    callback();

    if (!machine.docker.image) {
      log('destroy', containerId.slice(0, 16), 'success');
      return;
    }

    // If the machine had an intermediary image, clean it up.
    docker.removeImage({ host, image: machine.docker.image }, error => {
      if (error) {
        log('destroy', containerId.slice(0, 16), error);
        return;
      }

      log('destroy', containerId.slice(0, 16), 'success');
      machine.docker.image = '';
      db.save();
    });
  });
};

// Get an available user machine for a project, or create a new one.
function getMachine (user, projectId) {
  const project = getProject(projectId);
  if (!project) {
    log(new Error('Unknown project: ' + projectId +
      ' (while getting a machine for ' + user.email + ')'));
    return null;
  }

  let machines = user.machines[projectId];
  if (!machines) {
    machines = user.machines[projectId] = [];
  }

  let machine = machines[machines.length - 1];
  if (!machine /* || machine.status !== 'new' */) {
    machine = {
      id: machines.length,
      name: project.name + ' #' + machines.length,
      status: 'new',
      docker: {
        host: '',
        container: '',
        image: '',
        ports: {},
        logs: ''
      },
      data: {}
    };
    machines.push(machine);
  }

  // Force the machine to live on the project's (new) host.
  machine.docker.host = project.docker.host;

  // Make sure all the ports required by the project are provisioned.
  for (const projectPort in project.docker.ports) {
    if (!machine.docker.ports[projectPort]) {
      const { proxy } = project.docker.ports[projectPort];
      machine.docker.ports[projectPort] = {
        port: getPort(),
        proxy: proxy
      };
    }
  }

  db.save();

  return machine;
}

// Get a unique available port starting from 42000.
function getPort () {
  const ports = db.get('ports');
  const port = ports.next || 42000;

  ports.next = port + 1;
  db.save();

  return port;
}

// Find an existing project, or optionally create a new one for that ID.
function getProject (projectId, create) {
  const projects = db.get('projects');
  let project = projects[projectId];

  if (!project && create) {
    project = {
      id: projectId,
      name: '',
      icon: '',
      docker: {
        host: '',
        image: '',
        path: '',
        ports: {
          '22': {
            proxy: 'none'
          },
          '8088': {
            proxy: 'https'
          },
          '8089': {
            proxy: 'https'
          }
        },
        build: '',
        update: '',
        spawn: '',
        logs: ''
      },
      data: {}
    };
    projects[projectId] = project;
    db.save();
  }

  return project || null;
}

// Get the SHA-1 hash of a given string.
function hash (input) {
  return crypto.createHash('sha1').update(input, 'utf8').digest('hex');
} // Don't export `hash`.
