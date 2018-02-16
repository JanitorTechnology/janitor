// Copyright © 2017 Michael Howell. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const https = require('https');

const db = require('./db');
const metrics = require('./metrics');

// Big note for anybody who's trying to understand how the blog works:
// Discourse is made up of "topics" that contain one or more "posts".
// The first post in a published[^1] blog[^2] topic is considered the blog post itself.
// The rest are comments on it.
//
// [^1] "published" is a staff-only-tag.
// [^2] "blog" is a category, and is not staff-only.

const discourseBlogCategoryID = 9;
const discourseBlogTopicsUrl = 'https://discourse.janitor.technology/tags/published';
const discourseBlogPostUrlTemplate = 'https://discourse.janitor.technology/t/{{slug}}/{{id}}/1';
const discourseBlogCommentsUrlTemplate = 'https://discourse.janitor.technology/t/{{slug}}/{{id}}/2';

// Perform an asynchronous Discourse API request.
function fetchDiscourseAPI (url) {
  return new Promise((resolve, reject) => {
    https.get(url + '.json', response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => {
        const json = Buffer.concat(chunks).toString();
        const { statusCode } = response;
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error('Unexpected Discourse API response: ' +
            statusCode + '\n' + json));
          return;
        }
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
    topics: [],
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
  const publishedTag = await fetchDiscourseAPI(discourseBlogTopicsUrl);
  let { topics } = publishedTag.topic_list;
  // Remove "published" topics that are not actual blog posts.
  topics = topics.filter(topic => {
    return topic && topic.category_id === discourseBlogCategoryID;
  });
  // Order topics
  topics.sort((a, b) => {
    if (a.created_at > b.created_at) {
      return -1;
    }
    if (a.created_at === b.created_at) {
      return 0;
    }
    return 1;
  });
  const topicsPromises = topics.map(async topic => {
    const bodyUrl = module.exports.getPostUrl(topic);
    const { post_stream } = await fetchDiscourseAPI(bodyUrl);
    topic.post_body_html = post_stream.posts[0].cooked;
    return topic;
  });
  blog.topics = await Promise.all(topicsPromises);
  const now = Date.now();
  metrics.set(blog, 'updated', now);
  metrics.push(blog, 'pull-time', [now, now - time]);
  db.save();
  return { count: topics.length };
};
