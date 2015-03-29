var db = require('./db');
var shipyard = require('./shipyard');


// List all tracked projects.

function getUpdatedProjects (callback) {

  shipyard.getImages(function (err, data) {

    var images = {};
    var projects = db.get('projects');

    data.forEach(function (image) {
      if (image.tag === 'latest') {
        images[image.repository] = image;
      }
    });

    for (var id in projects) {
      var image = images[projects[id].docker];
      projects[id].updated = image ? image.created.toLowerCase() : 'never';
    }

    callback(null, projects);
    db.save();

  });

}

exports.getUpdatedProjects = getUpdatedProjects;
