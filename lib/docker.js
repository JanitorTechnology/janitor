// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

let dockerode = require('dockerode');
let tar = require('tar-stream');
let stream = require('stream');
let stringdecoder = require('string_decoder');
let util = require('util');

let db = require('./db');
let hosts = require('./hosts');

// Get client access to a given Docker host.
function getDocker (hostname, callback) {
  let host = hosts.get(hostname);
  if (!host) {
    callback(new Error('Unknown Docker host: ' + hostname));
    return;
  }

  let client = db.get('tls').client;
  let docker = new dockerode({
    protocol: 'https',
    host: hostname,
    port: Number(host.properties.port),
    ca: host.properties.ca || client.ca,
    cert: host.properties.cert || host.properties.crt || client.crt,
    key: host.properties.key || client.key
  });

  callback(null, docker);
}

// Build a Docker image from a given Dockerfile.
exports.buildImage = function (parameters, callback) {
  let host = parameters.host;
  let tag = parameters.tag;
  let dockerfile = parameters.dockerfile;

  getDocker(host, (error, docker) => {
    if (error) {
      callback(error);
      return;
    }

    // Add the Dockerfile to a tar stream for Docker's Remote API.
    let pack = tar.pack();
    pack.entry({ name: 'Dockerfile' }, dockerfile);
    pack.finalize();

    // FIXME: If `docker.buildImage()` ever supports streams, use the tar stream
    // directly instead of flushing it into a Buffer.
    let chunks = [];
    pack.on('data', (chunk) => { chunks.push(chunk); });
    pack.on('end', () => {
      let buffer = Buffer.concat(chunks);
      let options = {
        t: tag,
        nocache: true
      };

      docker.buildImage(buffer, options, (error, response) => {
        if (error) {
          callback(error);
          return;
        }

        // Transform Docker's response into a proper Node.js Stream.
        let dockerResponse = new DockerResponse();
        response.pipe(dockerResponse);

        callback(null, dockerResponse);
      });
    });
  });
};

// Delete a Docker image from a given host.
exports.removeImage = function (parameters, callback) {
  let host = parameters.host;
  let imageId = parameters.image;

  getDocker(host, (error, docker) => {
    if (error) {
      callback(error);
      return;
    }

    let image = docker.getImage(imageId);

    image.remove((error, data) => {
      callback(error);
    });
  });
};

// Spawn a new Docker container from a given image.
exports.runContainer = function (parameters, callback) {
  let host = parameters.host;
  let image = parameters.image;
  let ports = parameters.ports;

  getDocker(host, (error, docker) => {
    if (error) {
      callback(error);
      return;
    }

    let options = {
      Image: image,
      ExposedPorts: {},
      HostConfig: { PortBindings: {} }
    };

    for (let port in ports) {
      options.ExposedPorts[port + '/tcp'] = {};
      options.HostConfig.PortBindings[port + '/tcp'] = [{
        HostIp: (ports[port].publish ? '0.0.0.0' : '127.0.0.1'),
        HostPort: String(ports[port].hostPort)
      }];
    }

    docker.createContainer(options, (error, container) => {
      if (error) {
        callback(error, container);
        return;
      }
      container.start((error, data) => {
        callback(error, container);
      });
    });
  });
};

// Copy files into a given Docker container.
exports.copyIntoContainer = function (parameters, callback) {
  let host = parameters.host;
  let containerId = parameters.container;
  let files = parameters.files;
  let path = parameters.path;

  getDocker(host, (error, docker) => {
    if (error) {
      callback(error);
      return;
    }

    // Add the files to a tar stream for Docker's Remote API.
    let pack = tar.pack();
    for (let name in files) {
      pack.entry({ name: name }, files[name]);
    }
    pack.finalize();

    // FIXME: If `container.putArchive()` ever supports streams, use the tar
    // stream directly instead of flushing it into a Buffer.
    let chunks = [];
    pack.on('data', (chunk) => { chunks.push(chunk); });
    pack.on('end', () => {
      let buffer = Buffer.concat(chunks);
      let container = docker.getContainer(containerId);

      container.putArchive(buffer, { path: path }, (error, response) => {
        callback(error);
      });
    });
  });
};

// Execute a specific command inside a given Docker container.
exports.execInContainer = function (parameters, callback) {
  let host = parameters.host;
  let command = parameters.command;
  let containerId = parameters.container;

  getDocker(host, (error, docker) => {
    if (error) {
      callback(error);
      return;
    }

    let container = docker.getContainer(containerId);
    let options = {
      Cmd: command,
      AttachStdout: true,
      AttachStderr: true
    };

    container.exec(options, (error, exec) => {
      if (error) {
        callback(error);
        return;
      }
      exec.start((error, stream) => {
        callback(error, stream);
      });
    });
  });
};

// Kill and delete a Docker container from a given host.
exports.removeContainer = function (parameters, callback) {
  let host = parameters.host;
  let containerId = parameters.container;

  getDocker(host, (error, docker) => {
    if (error) {
      callback(error);
      return;
    }

    let container = docker.getContainer(containerId);

    container.remove({ force: true }, (error, data) => {
      callback(error);
    });
  });
};


// Get the Docker version of a given host.
exports.version = function (parameters, callback) {
  let host = parameters.host;

  getDocker(host, (error, docker) => {
    docker.version((error, data) => {
      callback(error, data);
    });
  });
};

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

util.inherits(DockerResponse, stream.Transform);

// Transform Docker response chunks into a proper Node.js Stream.
DockerResponse.prototype._transform = function (chunk, encoding, callback) {
  // Decode the chunk as a UTF-8 string.
  this._buffer += this._decoder.write(chunk);

  // Split on line breaks.
  let lines = this._buffer.split(/\r?\n/);

  // Keep the last partial line buffered.
  this._buffer = lines.pop();

  // Parse all other lines.
  for (let i = 0; i < lines.length; i++) {
    this._parse(lines[i]);
  }

  callback();
};

// Parse Docker response lines as JSON.
DockerResponse.prototype._parse = function (line) {
  try {
    // We expect JSON objects formatted like `{stream:'…'}` or `{error:'…'}`.
    // Example: https://docs.docker.com/engine/reference/api/docker_remote_api_v1.22/#build-image-from-a-dockerfile
    let data = JSON.parse(line);
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
  let line = this._buffer.trim();
  this._buffer = '';

  if (line) {
    this._parse(line);
  }

  callback();
};
