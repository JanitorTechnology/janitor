// Copyright © 2015 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

var crypto = require('crypto');

var db = require('./db');
var log = require('./log');
var shipyard = require('./shipyard');


// List available machines for each project for a user.

function getAvailableMachines (user) {

  var machines = {};

  for (var id in db.get('projects')) {
    machines[id] = getMachine(id, user);
  }

  return machines;

}

exports.getAvailableMachines = getAvailableMachines;


// List all tracked projects.

function getProjects (callback) {

  shipyard.getImages(function (err, data) {

    var images = {};

    data.forEach(function (image) {
      if (image.tag === 'latest') {
        images[image.repository] = image;
      }
    });

    var projects = db.get('projects');

    for (var id in projects) {
      var image = images[projects[id].docker.image];
      projects[id].updated = image ? image.created.toLowerCase() : 'never';
    }

    callback(null, projects);
    db.save();

  });

}

exports.getProjects = getProjects;


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
  var command = project.docker.build;

  log('rebuild', image, 'started');

  shipyard.buildImage(image, command, function (error, logs) {
    log('rebuild', image, (error ? error.toString() : 'success'));
    project.docker.logs = logs;
    callback(error, logs);
  });

}

exports.rebuild = rebuild;


// Update the base image of a project.

function update (projectId, callback) {

  var project = getProject(projectId);
  var image = project.docker.image;
  var command = 'FROM ' + image + '\n' + project.docker.update;

  log('update', image, 'started');

  shipyard.buildImage(image, command, function (error, logs) {
    log('update', image, (error ? error.toString() : 'success'));
    project.docker.logs = logs;
    callback(error, logs);
  });

}

exports.update = update;


// Instantiate a user machine for a project. (Fast!)

function spawn (projectId, user, callback) {

  var project = getProject(projectId);
  var machine = getMachine(projectId, user);
  var image = project.docker.image;

  // Don't re-spawn a machine that's already started.
  if (machine.status === 'started') {
    return callback(null, machine.docker.logs);
  }

  // Template the user's Cloud9 key into the spawning rules.
  var command = 'FROM ' + image + '\n' + project.docker.spawn;
  command = command.replace(/%CLOUD9_KEY%/g, user.keys.cloud9);

  log('spawn-build', image, 'started');

  var tag = hash(user.email + ' ' + projectId + ' ' + machine.id);

  shipyard.buildImage(tag, command, function (error, logs) {

    log('spawn-build', image, (error ? error.toString() : 'success'));

    machine.docker.image = tag;
    machine.docker.logs = logs;
    machine.status = 'built';

    if (error) {
      machine.status = 'error';
      db.save();
      return callback(error, logs);
    }

    // Expose the machine's SSH port publicly, keep its VNC port private.
    var ports = [
      '0.0.0.0:' + machine.ports.ssh + ':22',
      '127.0.0.1:' + machine.ports.vnc + ':8088'
    ];

    log('spawn-run', image, 'started');

    shipyard.runContainer(tag, ports, function (error, logs) {
      log('spawn-run', image, (error ? error.toString() : 'success'));
      machine.docker.logs += '\n---\n\n' + logs;
      if (error) {
        machine.status = 'error';
      } else {
        machine.status = 'started';
      }
      db.save();
      return callback(error, machine.docker.logs);
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
      ports: {
        ssh: getPort(),
        vnc: getPort()
      },
      docker: {
        image: '',
        logs: ''
      },
      status: 'new'
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
        build: '',
        update: '',
        spawn: '',
        logs: ''
      }
    }
    projects[id] = project;
    db.save();
  }

  return project;

} // Don't export `getProject`.


// Get the SHA-1 hash of a given string.

function hash (input) {

  return crypto.createHash('sha1').update(input, 'utf8').digest('hex');

} // Don't export `hash`.
