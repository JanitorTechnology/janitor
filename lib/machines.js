// Copyright © 2015 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

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
    machines[projectId] = getOrCreateNewMachine(user, projectId);
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
  jsonpatch.applyPatch(project, operations);
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
      log('[fail] rebuild', image, error);
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

  const { host, update: dockerfile, _productionImage: image } = project.docker;
  const time = Date.now();

  docker.buildImage({ host, tag: image, dockerfile }, (error, stream) => {
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

  const machine = getOrCreateNewMachine(user, projectId);

  // Keep track of the last project update this machine will be based on.
  metrics.set(machine, 'updated', project.data.updated);

  // Specify which ports should be exposed publicly or kept private.
  const ports = {};
  for (const projectPort in machine.docker.ports) {
    const { port, proxy } = machine.docker.ports[projectPort];
    ports[projectPort] = {
      hostPort: port,
      publish: proxy === 'none'
    };
  }

  const { host, _productionImage: image } = project.docker;
  const time = Date.now();

  log('spawn', image, 'started');
  docker.runContainer({ host, image, ports }, (error, container, logs) => {
    if (error) {
      log('spawn', image, error);
      machine.status = 'start-failed';
      db.save();
      callback(new Error('Unable to start machine for project: ' + projectId));
      return;
    }

    log('spawn', image, 'success', container.id.slice(0, 16));
    machine.docker.container = container.id;
    machine.docker.logs = String(logs);
    machine.status = 'started';

    const now = Date.now();
    metrics.push(project, 'spawn-time', [ now, now - time ]);
    db.save();

    // Quickly authorize the user's public SSH keys to access this container.
    deploySSHAuthorizedKeys(user, machine, error => {
      log('spawn-sshkeys', container.id.slice(0, 16), error || 'success');
      db.save();
    });

    // Install all non-empty user configuration files into this container.
    Object.keys(user.configurations).forEach(file => {
      if (!user.configurations[file]) {
        return;
      }
      exports.deployConfiguration(user, machine, file).then(() => {
        log('spawn-config', file, container.id.slice(0, 16), 'success');
      }).catch(error => {
        log('spawn-config', file, container.id.slice(0, 16), error);
      });
    });

    callback();
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
      delete machine.docker.image;
      db.save();
    });
  });
};

// Install or overwrite a configuration file in all the user's containers.
exports.deployConfigurationInAllContainers = function (user, file) {
  let count = 0;
  // eslint-disable-next-line node/no-unsupported-features
  const machines = Object.values(user.machines)
    .reduce((machines, projectMachines) => machines.concat(projectMachines), [])
    .filter(machine => machine.status === 'started');

  return Promise.all(machines.map(machine => {
    const { container: containerId } = machine.docker;
    return exports.deployConfiguration(user, machine, file).then(() => {
      log('deploy-config', file, containerId.slice(0, 16), 'success');
      count++;
    }).catch(error => {
      log('[fail] deploy-config', file, containerId.slice(0, 16), error);
      // Continue deploying to other containers anyway.
    });
  })).then(() => count);
};

// Install or overwrite a configuration file in a given user container.
exports.deployConfiguration = function (user, machine, file) {
  const { host, container: containerId } = machine.docker;
  if (containerId.length < 16 || !/^[0-9a-f]+$/.test(containerId)) {
    return Promise.reject(new Error('Invalid container ID: ' + containerId));
  }

  return new Promise((resolve, reject) => {
    docker.copyIntoContainer({
      host,
      container: containerId,
      path: '/home/user/',
      files: {
        [file]: user.configurations[file],
      }
    }, error => {
      if (error) {
        reject(error);
        return;
      }

      // FIXME: Remove this workaround when the following Docker bug is fixed:
      // https://github.com/docker/docker/issues/21651.
      const command = `sudo chown user:user /home/user/${file}`;
      docker.execInContainer({
        host,
        container: containerId,
        command
      }, error => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });
};

// Reset a user machine's list of authorized SSH public keys.
function deploySSHAuthorizedKeys (user, machine, callback) {
  let authorizedKeys = [ user.keys.cloud9 ];
  if ('github' in user.keys) {
    authorizedKeys = authorizedKeys.concat(user.keys.github.authorizedKeys);
  }

  const { host, container: containerId } = machine.docker;
  const parameters = {
    host,
    container: containerId,
    path: '/home/user/.ssh/',
    files: {
      authorized_keys: authorizedKeys.join('\n')
    }
  };

  docker.copyIntoContainer(parameters, error => {
    if (error) {
      callback(error);
      return;
    }

    // FIXME: Remove this workaround when the following Docker bug is fixed:
    // https://github.com/docker/docker/issues/21651.
    const command = 'sudo chown user:user /home/user/.ssh/authorized_keys';
    docker.execInContainer({ host, container: containerId, command }, error => {
      callback(error);
    });
  });
}

// Get an available user machine for a project, or create a new one.
function getOrCreateNewMachine (user, projectId) {
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
  if (!machine || machine.status !== 'new') {
    machine = {
      id: machines.length,
      properties: {
        name: project.name + ' #' + machines.length,
      },
      status: 'new',
      docker: {
        host: '',
        container: '',
        ports: {},
        logs: ''
      },
      data: {}
    };
    machines.push(machine);
  }

  // Force the new machine to live on the project's (new) host.
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
        logs: ''
      },
      data: {}
    };
    projects[projectId] = project;
    db.save();
  }

  if (!project) {
    return null;
  }

  // Get a hidden internal Docker image tagged with ':janitor-production'.
  if (!project.docker.hasOwnProperty('_productionImage')) {
    Object.defineProperty(project.docker, '_productionImage', {
      get () {
        return this.image.split(':')[0] + ':janitor-production';
      }
    });
  }

  return project;
}
