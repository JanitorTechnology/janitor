// Copyright © 2017 Michael Howell. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const selfapi = require('selfapi');

const blog = require('../lib/blog');
const log = require('../lib/log');

// API resource to manage Janitor's Discourse-backed news section.
const blogAPI = module.exports = selfapi({
  title: 'Blog'
});

// API sub-resource for the sync webhook.
const webhookAPI = blogAPI.api('/sync-webhook');

webhookAPI.get({
  title: 'Synchronize',
  description: 'Pull the blog section from Discourse.',

  handler: (_request, response) => {
    blog.pull().then(null, log);
    response.json({}, null, 2);
  },

  examples: [{
    response: {
      body: JSON.stringify({}, null, 2)
    }
  }]
});
