// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

var dockerode = require('dockerode');
var fs = require('fs');
var tar = require('tar-stream');
var stream = require('stream');
var util = require('util');

var db = require('./db');

// Available Docker certificates and hosts.
var client = {};
var dockers = {};
load();


// Load Docker client certificates and host configurations.

function load () {

  // Load the default CA and client certificates synchronously.
  client.ca = fs.readFileSync('ca.crt', 'utf8');
  client.crt = fs.readFileSync('client.crt', 'utf8');
  client.key = fs.readFileSync('client.key', 'utf8');

  // Get all host configurations.
  var hosts = db.get('dockers');

  // Add `localhost` by default.
  if (!hosts.localhost) {
    hosts.localhost = { host: 'localhost', port: 2376 };
  }

  // Configure all Docker hosts.
  for (var id in hosts) {
    var host = hosts[id];
    dockers[id] = new dockerode({
      protocol: 'https',
      host: host.host,
      port: host.port,
      ca: host.ca || client.ca,
      cert: host.cert || host.crt || client.crt,
      key: host.key || client.key
    });
  }

} // Don't export `load`.


// Build a Docker image from a given Dockerfile.

function buildImage (parameters, callback) {

  var tag = parameters.tag;
  var dockerfile = parameters.dockerfile;
  var host = parameters.host || 'localhost';
  var docker = dockers[host];

  if (!docker) {
    return callback(new Error('Unknown Docker Host: ' + host));
  }

  // Add the Dockerfile to a tar stream for Docker's Remote API.
  var pack = tar.pack();
  pack.entry({ name: 'Dockerfile' }, dockerfile);
  pack.finalize();

  // FIXME: If `docker.buildImage()` ever supports streams, use the tar stream
  // directly instead of flushing it into a Buffer.
  var chunks = [];
  pack.on('data', function (chunk) { chunks.push(chunk); });
  pack.on('end', function () {

    var buffer = Buffer.concat(chunks);
    var options = {
      t: tag,
      nocache: true
    };

    docker.buildImage(buffer, options, function (error, response) {

      if (error) {
        return callback(error);
      }

      // Transform Docker's response into a proper Node.js Stream.
      var dockerResponse = new DockerResponse();
      response.pipe(dockerResponse);

      return callback(null, dockerResponse);
    });

  });

}

exports.buildImage = buildImage;


// Spawn a new Docker container from a given image.

function runContainer (parameters, callback) {

  var image = parameters.image;
  var ports = parameters.ports;
  var host = parameters.host || 'localhost';
  var docker = dockers[host];

  if (!docker) {
    return callback(new Error('Unknown Docker Host: ' + host));
  }

  var options = {
    Image: image,
    ExposedPorts: {},
    HostConfig: { PortBindings: {} }
  };

  for (var port in ports) {
    options.ExposedPorts[port + '/tcp'] = {};
    options.HostConfig.PortBindings[port + '/tcp'] = [{
      HostIp: (ports[port].publish ? '0.0.0.0' : '127.0.0.1'),
      HostPort: String(ports[port].hostPort)
    }];
  }

  docker.createContainer(options, function (error, container) {
    if (error) {
      return callback(error, container);
    }
    container.start(function (error, data) {
      return callback(error, container);
    });
  });

}

exports.runContainer = runContainer;


// Docker Remote API response stream.

function DockerResponse (options) {

  // Allow use without `new`.
  if (!(this instanceof DockerResponse)) {
    return new DockerResponse(options);
  }

  // Make this a proper Transform stream.
  stream.Transform.call(this, options);

}

exports.DockerResponse = DockerResponse;

util.inherits(DockerResponse, stream.Transform);


// Transform Docker response chunks into a proper Node.js Stream.

DockerResponse.prototype._transform = function (chunk, encoding, callback) {

  // We expect JSON chunks formatted like `{stream:'…'}` or `{error:'…'}`.
  // Example: https://docs.docker.com/engine/reference/api/docker_remote_api_v1.22/#build-image-from-a-dockerfile
  try {
    var data = JSON.parse(String(chunk));
    if (data.error) {
      return callback(new Error(data.error));
    }
    if (data.stream) {
      return callback(null, data.stream);
    }
    // The chunk didn't have a `stream` or `error` property.
  } catch (error) {
    // The chunk is not valid JSON.
  }

  // If we failed to parse this chunk, forward it as-is.
  return callback(null, chunk);

};
