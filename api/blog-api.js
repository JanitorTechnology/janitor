// Copyright © 2017 Michael Howell. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const selfapi = require('selfapi');

const blog = require('../lib/blog');
const log = require('../lib/log');

// API resource to manage Janitor's Discourse-backed news section.
const blogAPI = module.exports = selfapi({
  title: 'Blog'
});

// API sub-resource for the Discourse-Blog synchronization webhook.
// should show up as https://janitor.technology/api/blog/synchronize
blogAPI.get('/synchronize', {
  title: 'Synchronize Blog',
  description: 'Pull the blog section from Discourse.',

  handler: async (_request, response) => {
    try {
      const status = await blog.synchronize();
      log('synchronized blog', status);
      response.json(status, null, 2);
    } catch (error) {
      log('[fail] synchronized blog', error);
      response.statusCode = 500; // Internal Server Error
      response.json({ error: 'Could not synchronize' }, null, 2);
    }
  },

  examples: [{
    response: {
      body: JSON.stringify({count: 1}, null, 2)
    }
  }]
});
