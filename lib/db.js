// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

var fs = require('fs');

// The datastore.
var file = './db.json';
var store = {};
load();


// Load the datastore from disk synchronously.

function load () {

  var json = '{}';

  try {
    json = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      // DB file doesn't exist yet, but will be created by `save()` eventually.
    } else {
      throw error; // Can't open DB file!
    }
  }

  store = JSON.parse(json);

}

exports.load = load;


// Save the datastore to disk asynchronously. TODO gzip?

function save () {

  var json = JSON.stringify(store, null, 2);

  fs.writeFile(file, json + '\n', function (error) {
    if (error) {
      console.error('Can\'t write DB file!', error.stack);
    }
    fs.chmod(file, 0600 /* read + write by owner */, function (error) {
      if (error) {
        console.error('Can\'t protect DB file!', error.stack);
      }
    });
  });

}

exports.save = save;


// Get or create an entry in the datastore.

function get (key, defaultValue) {

  if (!store[key]) {
    store[key] = defaultValue || {};
  }

  return store[key];

}

exports.get = get;
