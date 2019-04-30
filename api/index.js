// Copyright © 2016 Team Janitor. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const selfapi = require('selfapi');

// Janitor API root resource.
const api = module.exports = selfapi({
  title: 'Janitor API',
  description:
    'A simple JSON API to interact with Janitor containers, hosts and projects.'
});

// Janitor API sub-resources.
api.api('/blog', require('./blog-api'));
api.api('/hosts', require('./hosts-api'));
api.api('/projects', require('./projects-api'));
api.api('/user', require('./user-api'));
api.api('/admin', require('./admin-api'));
