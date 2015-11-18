// Copyright © 2015 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPLv3 license.

var fs = require('fs');

var store = JSON.parse(fs.readFileSync('./db.json', 'utf8'));


// Save the datastore to disk asynchronously. TODO gzip?

function save () {
  fs.writeFile('./db.json', JSON.stringify(store,0,2) + '\n', function (err) {
    if (err) {
      console.error('Error while saving db.json!', err);
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
