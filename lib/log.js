// Copyright © 2015 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPLv3 license.


// Log messages to the console with a timestamp.

function log() {

  var args = [].slice.call(arguments);
  args.unshift('[' + new Date().toISOString() + ']');

  console.log.apply(console, args);

}

module.exports = log;
