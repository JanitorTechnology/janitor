var exec = require('child_process').exec;
var fs = require('fs');
var http = require('http');
var https = require('https');

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
      } catch (err) {
        callback(err, String(chunk));
      }
    });
  });

  request.on('error', function (error) {
    console.error(error);
    callback(error);
  });

  request.end();

}


// Use the Docker daemon locally (for missing Shipyard features).

function docker (command, callback) {

  var commands = ['images'];

  if (commands.indexOf(command) < 0) {
    callback('Unauthorized Docker command "' + command + '"');
    return;
  }

  var cmd = 'docker --tlsverify --tlscacert=ca.crt --tlscert=shipyard.crt ';
  cmd += '--tlskey=shipyard.key -H=localhost:2376 ';
  cmd += command;

  exec(cmd, {}, function (err, stdout, stderr) {
    callback(err, {stdout: stdout, stderr: stderr});
  });

}


// List Docker images.

function getImages (callback) {

  docker('images', function(err, data) {
    var images = [];
    var lines = data.stdout.split('\n');
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


// List Docker containers.

function getContainers (callback) {

  apiQuery('/api/containers', null, callback);

}

exports.getContainers = getContainers;
