// Copyright © 2015 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

var crypto = require('crypto');

var db = require('./db');
var docker = require('./docker');
var log = require('./log');
var metrics = require('./metrics');
var streams = require('./streams');


// List available machines for each project for a user, create when necessary.

function getAvailableMachines (user) {

  var machines = {};

  for (var projectId in db.get('projects')) {
    machines[projectId] = getMachine(projectId, user);
  }

  return machines;

}

exports.getAvailableMachines = getAvailableMachines;


// Get an existing machine corresponding to a given project and ID.

function getMatchingMachine (projectId, machineId, user) {

  var machines = user.machines[projectId];

  if (!machines) {
    return null;
  }

  return machines[machineId] || null;

}

exports.getMatchingMachine = getMatchingMachine;


// Change the parameters of an existing project, or create a new project.

function setProject (parameters) {

  // Find the project with this ID, create it if necessary.
  var project = getProject(parameters.id, true);

  for (var name in parameters) {
    var value = parameters[name];

    // Recurse into the object, building the path if necessary.
    var object = project;
    var path = name.split('.');
    var child = path.pop();
    path.forEach(function (parent) {
      if (!(parent in object)) {
        object[parent] = {};
      }
      object = object[parent];
    });

    object[child] = value;
  }

  db.save();

}

exports.setProject = setProject;


// Rebuild the base image of a project. (Slow)

function rebuild (projectId, callback) {

  var project = getProject(projectId);
  var image = project.docker.image;
  var dockerfile = project.docker.build;
  var time = Date.now();

  var parameters = {
    tag: image,
    dockerfile: dockerfile
  };

  docker.buildImage(parameters, function (error, stream) {

    if (error) {
      log ('rebuild', image, String(error));
      return callback(error);
    }

    log('rebuild', image, 'started');
    streams.set(project.docker, 'logs', stream);

    stream.on('error', function (e) {
      log('rebuild', image, String(e));
      error = e;
    });

    stream.on('end', function () {
      if (!error) {
        log('rebuild', image, 'success');
        var now = Date.now();
        metrics.set(project, 'updated', now);
        metrics.push(project, 'build-time', [ now, now - time ]);
      }
      return callback(error);
    });

  });

}

exports.rebuild = rebuild;


// Update the base image of a project.

function update (projectId, callback) {

  var project = getProject(projectId);
  var image = project.docker.image;
  var dockerfile = project.docker.update;
  var time = Date.now();

  var parameters = {
    tag: image,
    dockerfile: dockerfile
  };

  docker.buildImage(parameters, function (error, stream) {

    if (error) {
      log('update', image, String(error));
      return callback(error);
    }

    log('update', image, 'started');
    streams.set(project.docker, 'logs', stream);

    stream.on('error', function (e) {
      log('update', image, String(e));
      error = e;
    });

    stream.on('end', function () {
      if (!error) {
        log('update', image, 'success');
        var now = Date.now();
        metrics.set(project, 'updated', now);
        metrics.push(project, 'update-time', [ now, now - time ]);
      }
      return callback(error);
    });

  });

}

exports.update = update;


// Instantiate a user machine for a project. (Fast!)

function spawn (projectId, user, callback) {

  var project = getProject(projectId);

  if (!project) {
    return callback(new Error('Invalid Project ID'));
  }

  var machine = getMachine(projectId, user);
  var image = project.docker.image;
  var dockerfile = project.docker.spawn;
  var time = Date.now();

  // Don't re-spawn a machine that's already started.
  if (machine.status === 'started') {
    return callback(null, machine.docker.logs);
  }

  // Template the user's Cloud9 key into the spawning rules.
  dockerfile = dockerfile.replace(/%CLOUD9_KEY%/g, user.keys.cloud9);

  // Compute a unique tag for this intermediary image.
  var tag = hash(user.email + ' ' + projectId + ' ' + machine.id);

  var parameters = {
    tag: tag,
    dockerfile: dockerfile
  };

  docker.buildImage(parameters, function (error, stream) {

    if (error) {
      log('spawn', image, String(error));
      machine.status = 'build-failed';
      db.save();
      return callback(error);
    }

    log('spawn', image, 'started');
    machine.docker.image = tag;
    machine.status = 'build-started';
    streams.set(machine.docker, 'logs', stream);

    stream.on('error', function (e) {
      log('spawn', image, String(e));
      machine.status = 'build-failed';
      error = e;
    });

    stream.on('end', function () {

      if (error) {
        db.save();
        return callback(error);
      }

      machine.status = 'built';

      var parameters = {
        image: tag,
        ports: {}
      };

      // Specify which ports should be exposed publicly or kept private.
      for (var port in machine.docker.ports) {
        parameters.ports[port] = {
          hostPort: machine.docker.ports[port],
          publish: project.docker.ports[port]
        };
      }

      docker.runContainer(parameters, function (error, container) {

        if (error) {
          log('spawn', image, String(error));
          machine.status = 'start-failed';
          db.save();
          return callback(error);
        }

        log('spawn', image, 'success');
        machine.docker.container = container.id;
        machine.status = 'started';

        var now = Date.now();
        metrics.push(project, 'spawn-time', [ now, now - time ]);

        // Keep track of the last project update this machine is based on.
        metrics.set(machine, 'updated', project.data.updated);

        db.save();
        return callback(error);

      });

    });

  });

}

exports.spawn = spawn;


// Destroy a given user machine and recycle its name and ports.

function destroy (machineId, projectId, user, callback) {

  var machines = user.machines[projectId];

  if (!machines) {
    return callback(new Error('No machines for project ' + projectId));
  }

  var machine = machines[machineId];

  if (!machine || machine.status === 'new') {
    // If there is no instantiated machine to destroy, do nothing.
    return callback(null);
  }

  var containerId = machine.docker.container;

  if (!containerId) {
    // This machine has no associated container, just recycle it as is.
    machine.status = 'new';
    db.save();
    return callback(null);
  }

  var parameters = {
    container: containerId,
    image: machine.docker.image,
    host: machine.docker.host
  };

  log('destroy', containerId, 'started');

  docker.removeContainer(parameters, function (error) {

    if (error) {
      log('destroy', containerId, String(error));
      return callback(error);
    }

    // Recycle the machine's name and ports.
    machine.status = 'new';
    machine.docker.container = '';
    db.save();
    callback(null);

    // Also clean up the machine's intermediary image.
    docker.removeImage(parameters, function (error) {
      if (error) {
        log('destroy', containerId, String(error));
        return;
      }
      log('destroy', containerId, 'success');
      machine.docker.image = '';
      db.save();
    });

  });

}

exports.destroy = destroy;


// Get an available user machine for a project, or create a new one.

function getMachine (projectId, user) {

  var project = getProject(projectId);

  if (!project) {
    log('Error: Invalid Project ID', projectId,
      '(while getting a machine for ' + user.email + ')');
    return null;
  }

  var machines = user.machines[projectId];

  if (!machines) {
    machines = user.machines[projectId] = [];
  }

  var machine = machines[machines.length - 1];

  if (!machine /* || machine.status !== 'new' */) {
    machine = {
      id: machines.length,
      name: project.name,
      status: 'new',
      docker: {
        container: '',
        image: '',
        ports: {},
        logs: ''
      },
      data: {}
    };
    // Provision all the ports required by the project.
    for (var port in project.docker.ports) {
      machine.docker.ports[port] = getPort();
    }
    machines.push(machine);
    db.save();
  }

  return machine;

} // Don't export `getMachine`.


// Get a unique available port starting from 42000.

function getPort () {

  var ports = db.get('ports');
  var port = ports.next || 42000;

  ports.next = port + 1;
  db.save();

  return port;

} // Don't export `getPort`.


// Find an existing project, or optionally create a new one for that ID.

function getProject (id, create) {

  var projects = db.get('projects');
  var project = projects[id];

  if (!project && create) {
    project = {
      id: id,
      name: '',
      icon: '',
      docker: {
        image: '',
        path: '',
        ports: {
          '22': true,
          '8088': false
        },
        build: '',
        update: '',
        spawn: '',
        logs: ''
      },
      data: {}
    };
    projects[id] = project;
    db.save();
  }

  return project || null;

} // Don't export `getProject`.


// Get the SHA-1 hash of a given string.

function hash (input) {

  return crypto.createHash('sha1').update(input, 'utf8').digest('hex');

} // Don't export `hash`.
