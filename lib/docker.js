// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const Dockerode = require('dockerode');
const tar = require('tar-stream');
const stream = require('stream');
const stringdecoder = require('string_decoder');
const util = require('util');

const db = require('./db');
const hosts = require('./hosts');

// Get client access to a given Docker host.
function getDocker (hostname) {
  const host = hosts.get(hostname);
  if (!host) {
    throw new Error('Unknown Docker host: ' + hostname);
  }

  const { ca, client } = db.get('tls');
  return new Dockerode({
    protocol: 'https',
    host: hostname,
    port: Number(host.properties.port),
    ca: host.properties.ca || ca.crt,
    cert: host.properties.cert || host.properties.crt || client.crt,
    key: host.properties.key || client.key
  });
}

// List all Docker images on a given host.
exports.listImages = async function ({ host }) {
  const docker = getDocker(host);
  return docker.listImages({ all: 1 });
};

// Build a Docker image from a given Dockerfile.
exports.buildImage = async function (parameters) {
  const { host, tag, dockerfile } = parameters;

  const docker = getDocker(host);

  // Add the Dockerfile to a tar stream for Docker's Remote API.
  const pack = tar.pack();
  pack.entry({ name: 'Dockerfile' }, dockerfile);
  pack.finalize();

  // FIXME: If `docker.buildImage()` ever supports streams, use the tar stream
  // directly instead of flushing it into a Buffer.
  const chunks = [];
  pack.on('data', chunk => { chunks.push(chunk); });
  return new Promise((resolve, reject) => {
    pack.on('end', async () => {
      try {
        const buffer = Buffer.concat(chunks);
        const options = {
          t: tag,
          nocache: true
        };

        const response = await docker.buildImage(buffer, options);

        // Transform Docker's response into a proper Node.js Stream.
        const dockerResponse = new DockerResponse();
        response.pipe(dockerResponse);

        resolve(dockerResponse);
      } catch (error) {
        reject(error);
      }
    });
  });
};

// Pull a Docker image into a given host.
exports.pullImage = async function (parameters) {
  const { host, image: imageId } = parameters;

  const docker = getDocker(host);
  return docker.pull(imageId);
};

// Get low-level information on a Docker image from a given host.
exports.inspectImage = async function (parameters) {
  const { host, image: imageId } = parameters;

  const docker = getDocker(host);
  const image = docker.getImage(imageId);
  return image.inspect();
};

// Tag a Docker image in a given host.
exports.tagImage = async function (parameters) {
  const { host, image: imageId, tag: tagId } = parameters;

  const docker = getDocker(host);

  const image = docker.getImage(imageId);
  const [ repo, tag = 'latest' ] = tagId.split(':');
  return image.tag({ repo, tag });
};

// Delete a Docker image from a given host.
exports.removeImage = async function (parameters) {
  const { host, image: imageId } = parameters;

  const docker = getDocker(host);

  const image = docker.getImage(imageId);
  return image.remove();
};

// List all Docker containers on a given host.
exports.listContainers = function (parameters) {
  const { host } = parameters;

  const docker = getDocker(host);

  return docker.listContainers({ all: 1 });
};

// Spawn a new Docker container from a given image.
exports.runContainer = async function (parameters) {
  const { host, image, ports } = parameters;

  const docker = getDocker(host);

  const options = {
    Image: image,
    ExposedPorts: {},
    HostConfig: { PortBindings: {} }
  };

  for (const port in ports) {
    options.ExposedPorts[port + '/tcp'] = {};
    options.HostConfig.PortBindings[port + '/tcp'] = [{
      HostIp: ports[port].publish ? '0.0.0.0' : '127.0.0.1',
      HostPort: String(ports[port].hostPort)
    }];
  }

  const container = await docker.createContainer(options);
  return { container, logs: await container.start() };
};

// Copy files into a given Docker container.
exports.copyIntoContainer = async function (parameters) {
  const { host, container: containerId, files, path } = parameters;

  const docker = getDocker(host);

  // Add the files to a tar stream for Docker's Remote API.
  const pack = tar.pack();
  for (const name in files) {
    pack.entry({ name }, files[name]);
  }
  pack.finalize();

  // FIXME: If `container.putArchive()` ever supports streams, use the tar
  // stream directly instead of flushing it into a Buffer.
  const chunks = [];
  pack.on('data', chunk => { chunks.push(chunk); });
  return new Promise((resolve, reject) => {
    pack.on('end', async () => {
      try {
        const buffer = Buffer.concat(chunks);
        const container = docker.getContainer(containerId);

        resolve(await container.putArchive(buffer, { path }));
      } catch (error) {
        reject(error);
      }
    });
  });
};

// Execute a specific command inside a given Docker container.
exports.execInContainer = async function (parameters) {
  const { host, container: containerId, command } = parameters;

  const docker = getDocker(host);
  const container = docker.getContainer(containerId);
  const options = {
    Cmd: [ '/bin/bash', '-c', command ],
    AttachStdout: true,
    AttachStderr: true
  };

  const exec = await container.exec(options);
  return exec.start();
};

// List all files that were modified, added or deleted in a Docker container.
exports.listChangedFilesInContainer = async function (parameters) {
  const { host, container: containerId } = parameters;

  const docker = getDocker(host);

  const container = docker.getContainer(containerId);
  return container.changes();
};

// Kill and delete a Docker container from a given host.
exports.removeContainer = async function (parameters) {
  const { host, container: containerId } = parameters;

  const docker = getDocker(host);

  const container = docker.getContainer(containerId);
  return container.remove({ force: true });
};

// Get the Docker version of a given host.
exports.version = async function (parameters) {
  const { host } = parameters;

  const docker = getDocker(host);
  return docker.version();
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
  const lines = this._buffer.split(/\r?\n/);

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
    // We expect JSON objects formatted like `{stream:'…'}`, `{error:'…'}` or `{aux:{…}}`.
    // Example: https://docs.docker.com/engine/api/v1.24/#build-image-from-a-dockerfile
    const data = JSON.parse(line);
    if (data.error) {
      this.emit('error', new Error(data.error));
    } else if (data.stream) {
      this.push(data.stream);
    } else if (data.aux) {
      // Emit auxilliary data for anyone interested, e.g. `{ID:'…'}`.
      this.emit('aux', data.aux);
    } else {
      // The object didn't have a `stream`, `error` or `aux` property!
      this.emit('error', new Error('Unknown format: ' + line));
    }
  } catch (error) {
    // The input was not valid JSON!
    this.emit('error', new Error('Invalid JSON: ' + line));
  }
};

// Flush any remaining data.
DockerResponse.prototype._flush = function (callback) {
  const line = this._buffer.trim();
  this._buffer = '';

  if (line) {
    this._parse(line);
  }

  callback();
};
