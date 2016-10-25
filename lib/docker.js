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

  let host = parameters.host;
  let tag = parameters.tag;
  let dockerfile = parameters.dockerfile;

  getDocker(host, (error, docker) => {

    if (error) {
      return callback(error);
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
          return callback(error);
        }

        // Transform Docker's response into a proper Node.js Stream.
        let dockerResponse = new DockerResponse();
        response.pipe(dockerResponse);

        return callback(null, dockerResponse);

      });

    });

  });

}

exports.buildImage = buildImage;


// Delete a Docker image from a given host.

function removeImage (parameters, callback) {

  let host = parameters.host;
  let imageId = parameters.image;

  getDocker(host, (error, docker) => {

    if (error) {
      return callback(error);
    }

    let image = docker.getImage(imageId);

    image.remove((error, data) => {
      return callback(error);
    });

  });

}

exports.removeImage = removeImage;


// Spawn a new Docker container from a given image.

function runContainer (parameters, callback) {

  let host = parameters.host;
  let image = parameters.image;
  let ports = parameters.ports;

  getDocker(host, (error, docker) => {

    if (error) {
      return callback(error);
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
        return callback(error, container);
      }
      container.start((error, data) => {
        return callback(error, container);
      });
    });

  });

}

exports.runContainer = runContainer;


// Copy files into a given Docker container.

function copyIntoContainer (parameters, callback) {

  let host = parameters.host;
  let containerId = parameters.container;
  let files = parameters.files;
  let path = parameters.path;

  getDocker(host, (error, docker) => {

    if (error) {
      return callback(error);
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
        return callback(error);
      });

    });

  });

}

exports.copyIntoContainer = copyIntoContainer;


// Execute a specific command inside a given Docker container.

function execInContainer (parameters, callback) {

  let host = parameters.host;
  let command = parameters.command;
  let containerId = parameters.container;

  getDocker(host, (error, docker) => {

    if (error) {
      return callback(error);
    }

    let container = docker.getContainer(containerId);

    container.exec({ Cmd: command }, (error, exec) => {
      if (error) {
        return callback(error);
      }
      exec.start((error, response) => {
        return callback(error);
      });
    });

  });

}

exports.execInContainer = execInContainer;


// Kill and delete a Docker container from a given host.

function removeContainer (parameters, callback) {

  let host = parameters.host;
  let containerId = parameters.container;

  getDocker(host, (error, docker) => {

    if (error) {
      return callback(error);
    }

    let container = docker.getContainer(containerId);

    container.remove({ force: true }, (error, data) => {
      return callback(error);
    });

  });

}

exports.removeContainer = removeContainer;


// Get the Docker version of a given host.

function version (parameters, callback) {

  let host = parameters.host;

  getDocker(host, (error, docker) => {

    docker.version((error, data) => {
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
  for (let i = 0; i < lines.length; i++) {
    this._parse(lines[i]);
  }

  return callback();

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

  return callback();

};
