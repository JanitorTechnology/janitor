// Copyright © 2015 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

var fs = require('fs');
var log = require('./log');

var store = {};
load();


// Load the datastore from disk synchronously.

function load () {
  try {
    store = JSON.parse(fs.readFileSync('./db.json', 'utf8'));
  } catch (error) {
    log('db.json load', error.toString());
  }
}

exports.load = load;


// Save the datastore to disk asynchronously. TODO gzip?

function save () {
  fs.writeFile('./db.json', JSON.stringify(store,0,2) + '\n', function (error) {
    if (error) {
      log('db.json save', error.toString());
    }
  });
}

exports.save = save;


// Get or create an entry in the datastore.

function get (key, defaultValue) {
  if (!store[key]) {
    store[key] = defaultValue || {};
    save();
  }
  return store[key];
}

exports.get = get;
