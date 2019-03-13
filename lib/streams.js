// Copyright © 2016 Team Janitor. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const stream = require('stream');

const log = require('./log');

// Streams that are currently in progress, per object.
const objectStreams = new Map();

// Get `object[key]` as a stream (may still be receiving new data).
exports.get = function (object, key) {
  const passthrough = new stream.PassThrough();
  const streams = objectStreams.get(object);

  if (object[key]) {
    passthrough.write(object[key], 'utf8');
  }

  if (streams && streams[key]) {
    streams[key].pipe(passthrough);
  } else {
    passthrough.end();
  }

  return passthrough;
};

// Read a stream into `object[key]`.
exports.set = function (object, key, readable) {
  let streams = objectStreams.get(object);

  if (!streams) {
    streams = {};
    objectStreams.set(object, streams);
  }

  streams[key] = readable;
  object[key] = '';

  // Save new data into `object[key]` as it comes in.
  readable.on('data', function (chunk) {
    object[key] += chunk;
  });

  // Remove the stream if an error occurs.
  readable.on('error', function (error) {
    if (error) {
      log('[fail] could not read the stream', error);
    }

    exports.remove(object, key);
  });

  // Clean up when the stream ends.
  readable.on('end', function () {
    exports.remove(object, key);
  });
};

// Remove any stream affected to `object[key]`.
exports.remove = function (object, key) {
  const streams = objectStreams.get(object);

  // If the stream doesn't exist, do nothing.
  if (!streams || !streams[key]) {
    return;
  }

  // Delete the stream.
  delete streams[key];

  // Clean up the `streams` object if empty.
  if (Object.keys(streams).length < 1) {
    objectStreams.delete(object);
  }
};
