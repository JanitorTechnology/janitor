// Copyright © 2015 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

var crypto = require('crypto');

var db = require('./db');
var docker = require('./docker');
var log = require('./log');
var metrics = require('./metrics');


// List available machines for each project for a user, create when necessary.

function getAvailableMachines (user) {

  var machines = {};

  for (var id in db.get('projects')) {
    machines[id] = getMachine(id, user);
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

  var project = getProject(parameters.id);

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

  log('rebuild', image, 'started');

  var parameters = {
    tag: image,
    dockerfile: dockerfile
  };

  docker.buildImage(parameters, function (error, logs) {
    log('rebuild', image, (error ? error.toString() : 'success'));
    project.docker.logs = logs;
    if (!error) {
      var now = Date.now();
      metrics.set(project, 'updated', now);
      metrics.push(project, 'build-time', [ now, now - time ]);
    }
    return callback(error);
  });

}

exports.rebuild = rebuild;


// Update the base image of a project.

function update (projectId, callback) {

  var project = getProject(projectId);
  var image = project.docker.image;
  var dockerfile = project.docker.update;
  var time = Date.now();

  log('update', image, 'started');

  var parameters = {
    tag: image,
    dockerfile: dockerfile
  };

  docker.buildImage(parameters, function (error, logs) {
    log('update', image, (error ? error.toString() : 'success'));
    project.docker.logs = logs;
    if (!error) {
      var now = Date.now();
      metrics.set(project, 'updated', now);
      metrics.push(project, 'update-time', [ now, now - time ]);
    }
    return callback(error);
  });

}

exports.update = update;


// Instantiate a user machine for a project. (Fast!)

function spawn (projectId, user, callback) {

  var project = getProject(projectId);
  var machine = getMachine(projectId, user);
  var image = project.docker.image;
  var dockerfile = project.docker.spawn;
  var time = Date.now();

  // Don't re-spawn a machine that's already started.
  if (machine.status === 'started') {
    return callback(null, machine.docker.logs);
  }

  log('spawn-build', image, 'started');

  // Template the user's Cloud9 key into the spawning rules.
  dockerfile = dockerfile.replace(/%CLOUD9_KEY%/g, user.keys.cloud9);

  // Compute a unique tag for this intermediary image.
  var tag = hash(user.email + ' ' + projectId + ' ' + machine.id);

  var parameters = {
    tag: tag,
    dockerfile: dockerfile
  };

  docker.buildImage(parameters, function (error, logs) {

    log('spawn-build', image, (error ? error.toString() : 'success'));

    machine.docker.image = tag;
    machine.docker.logs = logs;
    machine.status = 'built';

    if (error) {
      machine.status = 'build-failed';
      db.save();
      return callback(error);
    }

    log('spawn-run', image, 'started');

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

    docker.runContainer(parameters, function (error, logs) {
      log('spawn-run', image, (error ? error.toString() : 'success'));
      machine.docker.logs += '\n---\n\n' + logs;
      machine.status = (error ? 'start-failed' : 'started');
      if (!error) {
        var now = Date.now();
        metrics.push(project, 'spawn-time', [ now, now - time ]);
      }
      return callback(error);
    });

  });

}

exports.spawn = spawn;


// Get an available user machine for a project, or create a new one.

function getMachine (projectId, user) {

  var machines = user.machines[projectId];

  if (!machines) {
    machines = user.machines[projectId] = [];
  }

  var machine = machines[machines.length - 1];
  var project = getProject(projectId);

  if (!machine /* || machine.status !== 'new' */) {
    machine = {
      id: machines.length,
      name: project.name,
      docker: {
        container: '',
        image: '',
        ports: {},
        logs: ''
      },
      status: 'new'
    };
    // Provision all the ports required by the project.
    for (var port in project.docker.ports) {
      machine.docker.ports[port] = getPort();
    }
    // FIXME Temporary backward-compatibility, remove soon.
    machine.ports = {
      ssh: machine.docker.ports['22'],
      vnc: machine.docker.ports['8088']
    };
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


// Find an existing project, or create a new one for that ID.

function getProject (id) {

  var projects = db.get('projects');
  var project = projects[id];

  if (!project) {
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

  return project;

} // Don't export `getProject`.


// Get the SHA-1 hash of a given string.

function hash (input) {

  return crypto.createHash('sha1').update(input, 'utf8').digest('hex');

} // Don't export `hash`.
