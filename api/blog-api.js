// Copyright © 2017 Team Janitor. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const selfapi = require('selfapi');

const blog = require('../lib/blog');
const log = require('../lib/log');

// API resource to manage Janitor's Discourse-backed news section.
const blogAPI = module.exports = selfapi({
  title: 'Blog'
});

blogAPI.post('/synchronize', {
  title: 'Synchronize Blog',
  description: 'Pull the blog section from Discourse.',

  handler: async (_request, response) => {
    try {
      const { count } = await blog.synchronize();
      log('synchronized blog', { count });
      response.json({ count }, null, 2);
    } catch (error) {
      log('[fail] synchronized blog', error);
      response.statusCode = 500; // Internal Server Error
      response.json({ error: 'Could not synchronize' }, null, 2);
    }
  },

  // FIXME: Re-enable this test once syncing with Discourse doesn't cause frequent errors.
  // This can be achieved by rate-limiting our own sync requests, and/or by using a Discourse token.
  // See https://github.com/JanitorTechnology/janitor/issues/219
  examples: [/* {
    response: {
      body: JSON.stringify({ count: 13 }, null, 2)
    }
  } */]
});
