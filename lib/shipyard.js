// Copyright © 2015 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

var exec = require('child_process').exec;
var fs = require('fs');
var http = require('http');
var https = require('https');

var log = require('./log');

var api = {
  key: fs.readFileSync('./shipyard.apikey', 'utf8'),
  host: 'localhost',
  port: 8080
};


// Start a secure Shipyard proxy.

function start (settings) {

  var httpsOptions = {
    key: fs.readFileSync(settings.key),
    cert: fs.readFileSync(settings.cert),
    ca: settings.ca.map(function (file) {
      return fs.readFileSync(file);
    })
  };

  // Public-facing Shipyard HTTPS server.
  https.Server(httpsOptions, function (req, res) {

    var proxyOptions = {
      hostname: api.host,
      port: api.port,
      path: req.url,
      method: req.method,
      headers: req.headers
    };

    // Proxy request to the local Shipyard.
    var proxy = http.request(proxyOptions, function (response) {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res, {end: true});
    });

    req.pipe(proxy, {end: true});

  }).listen(settings.port);

}

exports.start = start;


// Use the Shipyard API locally.

function apiQuery (path, data, callback) {

  var options = {
    hostname: api.host,
    port: api.port,
    path: path,
    method: (data == null ? 'GET' : 'POST'),
    headers: {
      'X-Service-Key': api.key
    }
  };

  // Proxy request to the local Shipyard.
  var request = http.request(options, function (response) {
    response.on('data', function (chunk) {
      var data;
      try {
        data = JSON.parse(chunk);
        callback(null, data);
      } catch (error) {
        callback(error, String(chunk));
      }
    });
  });

  request.on('error', function (error) {
    console.error(error);
    callback(error);
  });

  request.end();

} // Don't export `apiQuery`.


// List Docker containers.

function getContainers (callback) {

  apiQuery('/api/containers', null, callback);

}

exports.getContainers = getContainers;


// Use the Docker daemon locally (for missing Shipyard features).

function docker (command, options, callback) {

  var cmd = 'docker --tlsverify --tlscacert=ca.crt --tlscert=shipyard.crt ';
  cmd += '--tlskey=shipyard.key -H=localhost:2376 ';

  switch (command) {
    case 'build':
      cmd += 'build';
      var image = options.image;
      if (image) {
        cmd += ' -t ' + image;
      }
      cmd += ' -';
      break;
    case 'images':
      cmd += 'images';
      break;
    case 'run':
      cmd += 'run -d';
      var ports = options.ports || [];
      ports.forEach(function (port) {
        cmd += ' -p ' + port;
      });
      cmd += ' ' + options.image;
      break;
    default:
      callback('Unauthorized Docker command "' + command + '"');
      return;
  }

  var opts = {
    maxBuffer: 5 * 1024 * 1024 // Allow buffers up to 5MB.
  };

  var child = exec(cmd, opts, function (error, stdout, stderr) {
    callback(error, stdout, stderr);
  });

  if (options.stdin) {
    child.stdin.setEncoding('utf8');
    child.stdin.end(options.stdin);
  }

} // Don't export `docker`.


// List Docker images.

function getImages (callback) {

  docker('images', {}, function (error, stdout, stderr) {
    var images = [];
    var lines = stdout.split('\n');
    var columns = lines[0].split(/\s\s+/).map(function (name) {
      return name.toLowerCase().replace(/\s/g, '');
    });
    for (var i = 1; i < lines.length; i++) {
      var image = {};
      var values = lines[i].split(/\s\s+/);
      for (var j = 0; j < values.length; j++) {
        image[columns[j]] = values[j];
      }
      images.push(image);
    }
    callback(null, images);
  });

}

exports.getImages = getImages;


// Build a Docker image with a given Docker command.

function buildImage (image, command, callback) {

  var options = {
    image: image,
    stdin: command + '\n'
  };

  docker('build', options, function (error, stdout, stderr) {
    var logs = 'STDERR:\n' + stderr + '\n\nSTDOUT:\n' + stdout;
    callback(error, logs);
  });

}

exports.buildImage = buildImage;


// Start a new Docker container from a given image.

function runContainer (image, ports, callback) {

  var options = {
    image: image,
    ports: ports
  }

  docker('run', options, function (error, stdout, stderr) {
    var logs = 'STDERR:\n' + stderr + '\n\nSTDOUT:\n' + stdout;
    callback(error, logs);
  });

}

exports.runContainer = runContainer;
