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


// Update a project image.

function updateProject (project) {

  var image = project.docker.image;
  var command = 'FROM ' + image + '\n' + project.docker.update;

  shipyard.updateImage(image, command, function (err, data) {

    log(( err == null ? 'update' : 'failed update' ),
      JSON.stringify(project.name), 'image', image);

  });

}

exports.updateProject = updateProject;


// Spawn a new machine for a project (fast!).

function spawn (project) {

  var machines = db.get('machines');

}

exports.spawn = spawn;
