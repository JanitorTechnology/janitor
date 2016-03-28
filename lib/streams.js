// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

var stream = require('stream');

// Streams that are currently in progress, per object.
var objectStreams = new Map();


// Get `object[key]` as a stream (may still be receiving new data).

function get (object, key) {

  var passthrough = new stream.PassThrough();
  var streams = objectStreams.get(object);

  if (object[key]) {
    passthrough.write(object[key], 'utf8');
  }

  if (streams && streams[key]) {
    streams[key].pipe(passthrough);
  } else {
    passthrough.end();
  }

  return passthrough;

}

exports.get = get;


// Read a stream into `object[key]`.

function set (object, key, readable) {

  var streams = objectStreams.get(object);

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

  // Clean everything up when the stream ends.
  readable.on('end', function () {
    delete streams[key];
    if (Object.keys(streams).length < 1) {
      objectStreams.delete(object);
    }
  });

}

exports.set = set;
