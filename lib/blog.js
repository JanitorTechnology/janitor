// Copyright © 2017 Team Janitor. All rights reserved.
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

const discourseBlogTopicsUrl = 'https://discourse.janitor.technology/tags/published?category=9&parent_category=8&order=created&ascending=false';
const discourseBlogPostUrlTemplate = 'https://discourse.janitor.technology/t/{{slug}}/{{id}}/1';
const discourseBlogCommentsUrlTemplate = 'https://discourse.janitor.technology/t/{{slug}}/{{id}}/2';
const default_delay = 500;
let delay = default_delay;

// Perform an asynchronous Discourse API request.
function fetchDiscourseAPI (url) {
  return new Promise((resolve, reject) => {
    const auth = db.get('discourse-auth-api');
    const auth_param = auth ? ('?api_key=' + auth.key + '&auth_username=' + auth.username) : '';
    const urlj = url + auth_param;
    const options = {
      headers: {
        Accept: 'application/json'
      }
    };
    https.get(urlj, options, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => {
        const json = Buffer.concat(chunks).toString();
        const { statusCode } = response;
        if (statusCode === 429) {
          setTimeout(() => {
            fetchDiscourseAPI(url).then(resolve, reject);
            delay = delay * 2;
            console.log('Blog sync API delay: ', delay);
          }, delay);
          return;
        } else if (statusCode < 200 || statusCode >= 300) {
          reject(new Error('Unexpected Discourse API response: ' +
            statusCode + '\n' + json + urlj));
          return;
        }
        try {
          resolve(JSON.parse(json));
        } catch (error) {
          reject(error);
        }
        delay = default_delay;
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
  const { topics } = publishedTag.topic_list;
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
