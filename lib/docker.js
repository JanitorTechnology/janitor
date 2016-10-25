// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

let dockerode = require('dockerode');
let fs = require('fs');
let tar = require('tar-stream');
let stream = require('stream');
let stringdecoder = require('string_decoder');
let util = require('util');

let hosts = require('./hosts');

// Default TLS client certificates.
let client = {
  ca: fs.readFileSync('ca.crt', 'utf8'),
  crt: fs.readFileSync('client.crt', 'utf8'),
  key: fs.readFileSync('client.key', 'utf8')
};


// Get client access to a given Docker host.

function getDocker (hostname, callback) {

  let host = hosts.get(hostname);

  if (!host) {
    return callback(new Error('Unknown Docker Host: ' + hostname));
  }

  let docker = new dockerode({
    protocol: 'https',
    host: hostname,
    port: Number(host.properties.port),
    ca: host.properties.ca || client.ca,
    cert: host.properties.cert || host.properties.crt || client.crt,
    key: host.properties.key || client.key
  });

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
