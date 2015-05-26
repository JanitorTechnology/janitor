var db = require('./db');
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
      var image = images[projects[id].docker];
      projects[id].updated = image ? image.created.toLowerCase() : 'never';
    }

    callback(null, projects);
    db.save();

  });

}

exports.getProjects = getProjects;


// Update a project image.

function updateProject (project) {

}

exports.updateProject = updateProject;


// Spawn a new machine for a project (fast!).

function spawn (project) {

  var machines = db.get('machines');

}

exports.spawn = spawn;
