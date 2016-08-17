// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

var dockerode = require('dockerode');
var fs = require('fs');
var tar = require('tar-stream');
var stream = require('stream');
var stringdecoder = require('string_decoder');
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


// Get the access point to a given Docker host.

function getDocker (host, callback) {

  var docker = dockers[host || 'localhost'];

  if (!docker) {
    return callback(new Error('Unknown Docker Host: ' + host));
  }

  return callback(null, docker);

} // Don't export `getDocker`.


// Build a Docker image from a given Dockerfile.

function buildImage (parameters, callback) {

  var host = parameters.host;
  var tag = parameters.tag;
  var dockerfile = parameters.dockerfile;

  getDocker(host, function (error, docker) {

    if (error) {
      return callback(error);
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

  });

}

exports.buildImage = buildImage;


// Delete a Docker image from a given host.

function removeImage (parameters, callback) {

  var host = parameters.host;
  var imageId = parameters.image;

  getDocker(host, function (error, docker) {

    if (error) {
      return callback(error);
    }

    var image = docker.getImage(imageId);

    image.remove(function (error, data) {
      return callback(error);
    });

  });

}

exports.removeImage = removeImage;


// Spawn a new Docker container from a given image.

function runContainer (parameters, callback) {

  var host = parameters.host;
  var image = parameters.image;
  var ports = parameters.ports;

  getDocker(host, function (error, docker) {

    if (error) {
      return callback(error);
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

  });

}

exports.runContainer = runContainer;


// Execute a specific command inside a given Docker container.

function execInContainer (parameters, callback) {

  var host = parameters.host;
  var command = parameters.command;
  var containerId = parameters.container;

  getDocker(host, function (error, docker) {

    if (error) {
      return callback(error);
    }

    var container = docker.getContainer(containerId);

    container.exec({ Cmd: command }, function (error, exec) {
      if (error) {
        return callback(error);
      }
      exec.start(function (error, response) {
        return callback(error);
      });
    });

  });

}

exports.execInContainer = execInContainer;


// Kill and delete a Docker container from a given host.

function removeContainer (parameters, callback) {

  var host = parameters.host;
  var containerId = parameters.container;

  getDocker(host, function (error, docker) {

    if (error) {
      return callback(error);
    }

    var container = docker.getContainer(containerId);

    container.remove({ force: true }, function (error, data) {
      return callback(error);
    });

  });

}

exports.removeContainer = removeContainer;


// Get the Docker version of a given host.

function version (parameters, callback) {

  var host = parameters.host;

  getDocker(host, function (error, docker) {

    docker.version(function (error, data) {
      return callback(error, data);
    });

  });

}

exports.version = version;


// Docker Remote API response stream.
// Inspired by `JSONParseStream`: https://nodejs.org/api/stream.html#stream_object_mode

function DockerResponse (options) {

  // Allow use without `new`.
  if (!(this instanceof DockerResponse)) {
    return new DockerResponse(options);
  }

  // Make this a proper Transform stream.
  stream.Transform.call(this, options);

  this._buffer = '';
  this._decoder = new stringdecoder.StringDecoder('utf8');

}

exports.DockerResponse = DockerResponse;

util.inherits(DockerResponse, stream.Transform);


// Transform Docker response chunks into a proper Node.js Stream.

DockerResponse.prototype._transform = function (chunk, encoding, callback) {

  // Decode the chunk as a UTF-8 string.
  this._buffer += this._decoder.write(chunk);

  // Split on line breaks.
  var lines = this._buffer.split(/\r?\n/);

  // Keep the last partial line buffered.
  this._buffer = lines.pop();

  // Parse all other lines.
  for (var i = 0; i < lines.length; i++) {
    this._parse(lines[i]);
  }

  return callback();

};


// Parse Docker response lines as JSON.

DockerResponse.prototype._parse = function (line) {

  try {

    // We expect JSON objects formatted like `{stream:'…'}` or `{error:'…'}`.
    // Example: https://docs.docker.com/engine/reference/api/docker_remote_api_v1.22/#build-image-from-a-dockerfile
    var data = JSON.parse(line);
    if (data.error) {
      this.emit('error', new Error(data.error));
    } else if (data.stream) {
      this.push(data.stream);
    } else {
      // The object didn't have a `stream` or `error` property!
      this.emit('error', new Error('Unknown format: ' + line));
    }

  } catch (error) {

    // The input was not valid JSON!
    this.emit('error', new Error('Invalid JSON: ' + line));

  }

};


// Flush any remaining data.

DockerResponse.prototype._flush = function (callback) {

  var line = this._buffer.trim();
  this._buffer = '';

  if (line) {
    this._parse(line);
  }

  return callback();

};
