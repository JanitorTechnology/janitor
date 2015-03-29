// Log messages to the console with a timestamp.

function log() {

  var args = [].slice.call(arguments);
  args.unshift('[' + Date.now() + ']');

  console.log.apply(console, args);

}

module.exports = log;
