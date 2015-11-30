// Copyright © 2015 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

var db = require('./db');
var log = require('./log');
var shipyard = require('./shipyard');


// List all tracked project images.

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

function rebuild (project) {

  // TODO

}

exports.rebuild = rebuild;


// Update the base image of a project.

function update (project) {

  var image = project.docker.image;
  var command = 'FROM ' + image + '\n' + project.docker.update;

  shipyard.updateImage(image, command, function (err, data) {

    log(( err == null ? 'update' : 'failed update' ),
      JSON.stringify(project.name), 'image', image);

  });

}

exports.update = update;


// Spawn a new machine for a project. (Fast!)

function spawn (project) {

  // TODO

}

exports.spawn = spawn;


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
        spawn: ''
      }
    }
    projects[id] = project;
    db.save();
  }

  return project;

} // Don't export `getProject`.
