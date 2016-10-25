// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

let selfapi = require('selfapi');


// Janitor API root resource.

let api = selfapi({
  title: 'Janitor API'
});

module.exports = api;


// Janitor API sub-resources.

api.api('/hosts', require('./hosts-api'));
