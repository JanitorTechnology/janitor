// Copyright © 2015 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const jsonpatch = require('fast-json-patch');

const db = require('./db');
const docker = require('./docker');
const log = require('./log');
const metrics = require('./metrics');
const streams = require('./streams');

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
      ' (while getting a machine for ' + user._primaryEmail + ')'));
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

// Download the project's latest Docker image.
exports.pull = function (projectId, callback) {
  const project = getProject(projectId);
  if (!project) {
    callback(new Error('Unknown project: ' + projectId));
    return;
  }

  const { host, _baseImage: image } = project.docker;
  const time = Date.now();

  docker.pullImage({ host, image }).then((stream) => {
    let error;
    log('pull', image, 'started');
    streams.set(project.docker, 'logs', stream);

    stream.on('error', err => {
      log('pull', image, err);
      error = err;
    });

    stream.on('end', () => {
      if (error) {
        callback(new Error('Problem while pulling project'));
        return;
      }

      // Inspect the pulled image to check its creation time.
      docker.inspectImage({ host, image }).then(data => {
        const imageCreated = new Date(data.Created).getTime();
        if (imageCreated <= project.data.updated) {
          // If the pulled image is as old as, or older than the Docker image
          // we currently use in production, stop here.
          log('pull-tag', image, 'success (old image not tagged)');
          callback(null, { image, created: imageCreated });
          return;
        }

        // The pulled image is more recent than the one we currently use in
        // production. Let's use the newer image, by tagging it appropriately.
        const { _productionImage: tag } = project.docker;
        docker.tagImage({ host, image, tag }).then(() => {
          log('pull-tag', image, tag, 'success');
          const now = Date.now();
          metrics.set(project, 'updated', imageCreated);
          metrics.push(project, 'pull-time', [now, now - time]);
          callback(null, { image, created: imageCreated });
        }, (error) => {
          log('pull-tag', image, tag, error);
          callback(new Error('Problem while tagging project'));
        });
      }, (error) => {
        log('pull-inspect', image, error);
        callback(new Error('Problem while inspecting image'));
      });
    });
  }, (error) => {
    log('pull', image, error);
    callback(new Error('Could not pull project'));
  });
};

// Build an incremental Docker image update for a project.
exports.update = function (projectId, callback) {
  const project = getProject(projectId);
  if (!project) {
    callback(new Error('Unknown project: ' + projectId));
    return;
  }

  const { host, update: dockerfile, _productionImage: image } = project.docker;
  const time = Date.now();

  docker.buildImage({ host, tag: image, dockerfile }).then(stream => {
    log('update', image, 'started');
    streams.set(project.docker, 'logs', stream);
    let error;

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
      metrics.push(project, 'update-time', [now, now - time]);
      callback();
    });
  }, function (error) {
    log('update', image, error);
    callback(new Error('Unable to update project: ' + projectId));
  });
};

// Instantiate a user machine for a project. (Fast!)
exports.spawn = async function (user, projectId) {
  const project = getProject(projectId);
  if (!project) {
    throw new Error('Unknown project: ' + projectId);
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
  let container;
  try {
    ({ container } = await docker.runContainer({ host, image, ports }));
    log('spawn', image, 'success', container.id.slice(0, 16));
    machine.docker.container = container.id;
    machine.status = 'started';
  } catch (error) {
    log('spawn', image, error);
    throw new Error('Unable to start machine for project: ' + projectId);
  }

  const now = Date.now();
  metrics.push(project, 'spawn-time', [now, now - time]);
  db.save();

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

  return machine;
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
  docker.removeContainer({ host, container: containerId }, () => {
    // Recycle the machine's name and ports.
    machine.status = 'new';
    machine.docker.container = '';
    db.save();

    log('destroy', containerId.slice(0, 16), 'success');
    callback();
  }, (error) => {
    log('destroy', containerId.slice(0, 16), error);
    callback(error);
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
    const containerId = machine.docker.container;
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
exports.deployConfiguration = async function (user, machine, file) {
  const { host, container: containerId } = machine.docker;
  if (containerId.length < 16 || !/^[0-9a-f]+$/.test(containerId)) {
    throw new Error('Invalid container ID: ' + containerId);
  }

  await docker.copyIntoContainer({
    host,
    container: containerId,
    path: '/home/user/',
    files: {
      [file]: user.configurations[file],
    }
  });

  // FIXME: Remove this workaround when the following Docker bug is fixed:
  // https://github.com/docker/docker/issues/21651.
  const command = `sudo chown user:user /home/user/${file}`;
  return docker.execInContainer({
    host,
    container: containerId,
    command
  });
};

// Get an available user machine for a project, or create a new one.
function getOrCreateNewMachine(user, projectId) {
  const project = getProject(projectId);
  if (!project) {
    log(new Error('Unknown project: ' + projectId +
      ' (while getting a machine for ' + user._primaryEmail + ')'));
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
        name: '',
      },
      status: 'new',
      docker: {
        host: '',
        container: '',
        ports: {},
      },
      data: {}
    };
    machines.push(machine);
  }

  // Reset any previous name this machine was given.
  machine.properties.name = project.name + ' #' + machines.length;

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
function getPort() {
  const ports = db.get('ports');
  const port = ports.next || 42000;

  ports.next = port + 1;
  db.save();

  return port;
}

// Find an existing project, or optionally create a new one for that ID.
function getProject(projectId, create) {
  const projects = db.get('projects');
  let project = projects[projectId];

  if (!project && create) {
    project = {
      id: projectId,
      name: '',
      description: '',
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

  // Temporary migration code: Previous projects didn't have a description.
  if (!project.description) {
    project.description = '';
  }

  // Get a full Docker image ID, with an explicit tag (by default ':latest').
  if (!project.docker.hasOwnProperty('_baseImage')) {
    Object.defineProperty(project.docker, '_baseImage', {
      get() {
        return this.image + (this.image.includes(':') ? '' : ':latest');
      }
    });
  }

  // Get a hidden internal Docker image tagged with ':janitor-production'.
  if (!project.docker.hasOwnProperty('_productionImage')) {
    Object.defineProperty(project.docker, '_productionImage', {
      get() {
        return this.image.split(':')[0] + ':janitor-production';
      }
    });
  }

  return project;
}
