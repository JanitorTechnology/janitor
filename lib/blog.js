// Copyright © 2017 Michael Howell. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const db = require('./db');
const https = require('https');
const metrics = require('./metrics');

// Big note for anybody who's trying to understand how the blog works:
// Discourse is made up of "topics" that contain one or more "posts".
// The first post in a published (published is a tag) blog (blog is a topic)
// post is considered the blog post itself. The rest are comments on it.

const discourseBlogCategoryID = 9;
const discourseBlogTopicsUrl = 'https://discourse.janitor.technology/tags/published';
const discourseBlogPostUrlTemplate = 'https://discourse.janitor.technology/t/{{slug}}/{{id}}/1';
const discourseBlogCommentsUrlTemplate = 'https://discourse.janitor.technology/t/{{slug}}/{{id}}/2';

// Perform an asynchronous Discourse API request.
function fetchDiscourseAPI (url) {
  return new Promise((resolve, reject) => {
    https.get(url + '.json', response_stream => {
      let json = '';
      response_stream.on('data', (chunk) => {
        try {
          json += chunk;
        } catch (error) {
          response_stream.destroy(error);
        }
      });
      response_stream.on('error', reject);
      response_stream.on('end', () => {
        try {
          resolve(JSON.parse(json));
        } catch (error) {
          reject(error);
        }
      });
    });
  });
}

// Get the cached Discourse-backed blog.
exports.getDb = function () {
  return db.get('blog', {
    'topics': [],
    'data': {
      'updated': null,
      'pull-time': [],
    },
  });
};

// Given a post from the database, get the title URL.
exports.getPostUrl = function (topic) {
  return discourseBlogPostUrlTemplate
    .replace('{{slug}}', topic.slug)
    .replace('{{id}}', topic.id);
};

// Given a post from the database, get the comment URL.
exports.getCommentsUrl = function (topic) {
  return discourseBlogCommentsUrlTemplate
    .replace('{{slug}}', topic.slug)
    .replace('{{id}}', topic.id);
};

// Synchronize the Discourse-backed blog into the database.
exports.synchronize = async function () {
  const blog = module.exports.getDb();
  const time = Date.now();
  let topics = await fetchDiscourseAPI(discourseBlogTopicsUrl).topic_list.topics;
  // Remove "published" topics that are not actual blog posts.
  for (const i in topics) {
    if (topics[i].category_id !== discourseBlogCategoryID) {
      delete topics[i];
    }
  }
  topics = topics.filter(Boolean);
  // Order topics
  topics.sort((a, b) => {
    if (a.created_at > b.created_at) {
      return -1;
    } else if (a.created_at === b.created_at) {
      return 0;
    } else {
      return 1;
    }
  });
  blog.topics = await Promise.all(topics.map(async topic => {
    const bodyUrl = module.exports.getPostUrl(topic);
    const bodyHtml = await fetchDiscourseAPI(bodyUrl).post_stream.posts[0].cooked;
    topic.post_body_html = bodyHtml;
    return topic;
  }));
  const now = Date.now();
  metrics.set(blog, 'updated', now);
  metrics.push(blog, 'pull-time', [now, Date.now() - time]);
  db.save();
  return { count: topics.length };
};
