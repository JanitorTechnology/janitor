// Copyright © 2016 Team Janitor. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const Dockerode = require('dockerode');
const tar = require('tar-stream');
const stream = require('stream');
const stringdecoder = require('string_decoder');
const util = require('util');

const db = require('./db');
const hosts = require('./hosts');
const log = require('./log');

// Get client access to a given Docker host.
function getDocker (hostname, callback) {
  const host = hosts.get(hostname);
  if (!host) {
    callback(new Error('Unknown Docker host: ' + hostname));
    return;
  }

  const { ca, client } = db.get('tls');
  const docker = new Dockerode({
    protocol: 'https',
    host: hostname,
    port: Number(host.properties.port),
    ca: host.properties.ca || ca.crt,
    cert: host.properties.cert || host.properties.crt || client.crt,
    key: host.properties.key || client.key
  });

  callback(null, docker);
}

// List all Docker images on a given host.
exports.listImages = function (parameters, callback) {
  const { host } = parameters;

  getDocker(host, (error, docker) => {
    if (error) {
      callback(error);
      return;
    }

    docker.listImages({ all: 1 }, (error, images) => {
      callback(error, images);
    });
  });
};

// Build a Docker image from a given Dockerfile.
exports.buildImage = function (parameters, callback) {
  const { host, tag, dockerfile } = parameters;

  getDocker(host, (error, docker) => {
    if (error) {
      callback(error);
      return;
    }

    // Add the Dockerfile to a tar stream for Docker's Remote API.
    const pack = tar.pack();
    pack.entry({ name: 'Dockerfile' }, dockerfile);
    pack.finalize();

    // FIXME: If `docker.buildImage()` ever supports streams, use the tar stream
    // directly instead of flushing it into a Buffer.
    const chunks = [];
    pack.on('data', chunk => { chunks.push(chunk); });
    pack.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const options = {
        t: tag,
        nocache: true
      };

      docker.buildImage(buffer, options, (error, response) => {
        if (error) {
          callback(error);
          return;
        }

        // Transform Docker's response into a proper Node.js Stream.
        const dockerResponse = new DockerResponse();
        response.pipe(dockerResponse);

        callback(null, dockerResponse);
      });
    });
  });
};

// Pull a Docker image into a given host.
exports.pullImage = function (parameters, callback) {
  const { host, image: imageId } = parameters;

  getDocker(host, (error, docker) => {
    if (error) {
      callback(error);
      return;
    }

    docker.pull(imageId, function (error, stream) {
      if (error) {
        callback(error);
        return;
      }

      callback(null, stream);
    });
  });
};

// Get low-level information on a Docker image from a given host.
exports.inspectImage = function (parameters, callback) {
  const { host, image: imageId } = parameters;

  getDocker(host, (error, docker) => {
    if (error) {
      callback(error);
      return;
    }

    const image = docker.getImage(imageId);
    image.inspect((error, data) => {
      callback(error, data);
    });
  });
};

// Tag a Docker image in a given host.
exports.tagImage = function (parameters, callback) {
  const { host, image: imageId, tag: tagId } = parameters;

  getDocker(host, (error, docker) => {
    if (error) {
      callback(error);
      return;
    }

    const image = docker.getImage(imageId);
    const [repo, tag = 'latest'] = tagId.split(':');
    image.tag({ repo, tag }, (error, data) => {
      callback(error);
    });
  });
};

// Delete a Docker image from a given host.
exports.removeImage = function (parameters, callback) {
  const { host, image: imageId } = parameters;

  getDocker(host, (error, docker) => {
    if (error) {
      callback(error);
      return;
    }

    const image = docker.getImage(imageId);
    image.remove((error, data) => {
      callback(error);
    });
  });
};

// List all Docker containers on a given host.
exports.listContainers = function (parameters, callback) {
  const { host } = parameters;

  getDocker(host, (error, docker) => {
    if (error) {
      callback(error);
      return;
    }

    docker.listContainers({ all: 1 }, (error, containers) => {
      callback(error, containers);
    });
  });
};

// Spawn a new Docker container from a given image.
exports.runContainer = function (parameters, callback) {
  const { host, image, ports } = parameters;

  getDocker(host, (error, docker) => {
    if (error) {
      callback(error);
      return;
    }

    const options = {
      Image: image,
      ExposedPorts: {},
      HostConfig: {
        CapAdd: ['SYS_PTRACE'],
        PortBindings: {},
      }
    };

    for (const port in ports) {
      options.ExposedPorts[port + '/tcp'] = {};
      options.HostConfig.PortBindings[port + '/tcp'] = [{
        HostIp: ports[port].publish ? '0.0.0.0' : '127.0.0.1',
        HostPort: String(ports[port].hostPort)
      }];
    }

    docker.createContainer(options, (error, container) => {
      if (error) {
        callback(error, container);
        return;
      }

      container.start((error, logs) => {
        callback(error, container, logs);
      });
    });
  });
};

// Copy files into a given Docker container.
exports.copyIntoContainer = function (parameters, callback) {
  const { host, container: containerId, files, path } = parameters;

  getDocker(host, (error, docker) => {
    if (error) {
      callback(error);
      return;
    }

    // Add the files to a tar stream for Docker's Remote API.
    const pack = tar.pack();
    for (const name in files) {
      pack.entry({ name, mode: 0o600 }, files[name]);
    }
    pack.finalize();

    // FIXME: If `container.putArchive()` ever supports streams, use the tar
    // stream directly instead of flushing it into a Buffer.
    const chunks = [];
    pack.on('data', chunk => { chunks.push(chunk); });
    pack.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const container = docker.getContainer(containerId);

      container.putArchive(buffer, { path }, (error, response) => {
        callback(error);
      });
    });
  });
};

// Execute a specific command inside a given Docker container.
exports.execInContainer = function (parameters, callback) {
  const { host, container: containerId, command } = parameters;

  getDocker(host, (error, docker) => {
    if (error) {
      callback(error);
      return;
    }

    const container = docker.getContainer(containerId);
    const options = {
      Cmd: ['/bin/bash', '-c', command],
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

// List all files that were modified, added or deleted in a Docker container.
exports.listChangedFilesInContainer = function (parameters, callback) {
  const { host, container: containerId } = parameters;

  getDocker(host, (error, docker) => {
    if (error) {
      callback(error);
      return;
    }

    const container = docker.getContainer(containerId);
    container.changes((error, changedFiles) => {
      callback(error, changedFiles);
    });
  });
};

// Kill and delete a Docker container from a given host.
exports.removeContainer = function (parameters, callback) {
  const { host, container: containerId } = parameters;

  getDocker(host, (error, docker) => {
    if (error) {
      callback(error);
      return;
    }

    const container = docker.getContainer(containerId);
    container.remove({ force: true }, (error, data) => {
      callback(error);
    });
  });
};

// Get the Docker version of a given host.
exports.version = function (parameters, callback) {
  const { host } = parameters;

  getDocker(host, (error, docker) => {
    if (error) {
      log('[fail] could not get the docker client', error);
    }
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
