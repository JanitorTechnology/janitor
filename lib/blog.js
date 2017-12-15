// Copyright © 2017 Michael Howell. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const db = require('./db');
const https = require('https');
const metrics = require('./metrics');

const fetchDiscourseAPI = function (url) {
  return new Promise((resolve, reject) => {
    const doResolve = (succ) => {
      let results = '';
      succ.on('data', (chunk) => {
        try {
          results += chunk;
        } catch (e) {
          succ.destroy(e);
        }
      });
      succ.on('error', reject);
      succ.on('end', () => {
        try {
          resolve(JSON.parse(results));
        } catch (e) {
          reject(e);
        }
      });
    };
    https.get(url + '.json', doResolve);
  });
};

const getDb = function () {
  return db.get('blog', {
    'posts': [],
    'topics_url': 'https://discourse.janitor.technology/tags/published',
    'post_url_template': 'https://discourse.janitor.technology/t/{{slug}}/{{id}}/1',
    'comments_url_template': 'https://discourse.janitor.technology/t/{{slug}}/{{id}}/2',
    'filter_category_id': 9,
    'data': {
      'updated': null,
      'pull-time': [
      ],
    },
  });
};

const pull = async function () {
  const blog = getDb();
  const topic = await fetchDiscourseAPI(blog.topics_url);
  blog.posts = topic.topic_list.topics;
  const time = Date.now();
  for (const post_i in blog.posts) {
    if (blog.posts[post_i].category_id !== blog.filter_category_id) {
      delete blog.posts[post_i];
    }
  }
  blog.posts.sort(function (a, b) {
    let ret_val;
    if (a.created_at > b.created_at) {
      ret_val = -1;
    } else if (a.created_at === b.created_at) {
      ret_val = 0;
    } else {
      ret_val = 1;
    }
    return ret_val;
  });
  for (const post_i in blog.posts) {
    const post_meta = blog.posts[post_i];
    const post_body_url = blog.post_url_template
      .replace('{{slug}}', post_meta.slug)
      .replace('{{id}}', post_meta.id);
    const post_body = (await fetchDiscourseAPI(post_body_url)).post_stream.posts[0].cooked;
    blog.posts[post_i].body_html = post_body;
  }
  const now = Date.now();
  metrics.set(blog, 'updated', now);
  metrics.push(blog, 'pull-time', [now, Date.now() - time]);
  db.save();
};

module.exports = {
  'pull': pull,
  'getDb': getDb,
};
