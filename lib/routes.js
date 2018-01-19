// Copyright © 2015 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const camp = require('camp');
const http = require('http');

const configurations = require('./configurations');
const db = require('./db');
const github = require('./github');
const log = require('./log');
const metrics = require('./metrics');

const security = db.get('security');

// Teach the templating system how to generate IDs (matching /[a-z0-9_-]*/).
camp.templateReader.parsers.id = text => {
  return text.replace(/[^\w-]/g, '').toLowerCase();
};

// Teach the templating system how to escape JSON Pointer tokens (RFC 6901).
camp.templateReader.parsers.jsonpointertoken = text => {
  return text.replace(/~/g, '~0').replace(/\//g, '~1');
};

// Teach the templating system how to escape booleans in text.
camp.templateReader.parsers.boolean = text => {
  return String(!!text);
};

// Redirect to a target URL.
exports.redirect = function (response, url, permanently = false) {
  response.statusCode = permanently ? 301 : 302;
  response.setHeader('Location', url);
  response.end();
};

// Drop an invalid request, optionally count and report consecutive attempts.
const consecutiveAttempts = {};
const consecutiveDelay = 1500;
exports.drop = function (response, reason = null) {
  // Immediately drop the request.
  response.statusCode = 400; // Bad Request
  response.end();

  if (!reason) {
    return;
  }

  // Count all attempts dropped for the same reason within a short time window.
  let { count = 0, timeout = null } = consecutiveAttempts[reason] || {};
  count++;
  clearTimeout(timeout);
  timeout = setTimeout(() => {
    log('[warning] dropped', count, 'request' + (count === 1 ? '' : 's'), 'for',
      reason);
    delete consecutiveAttempts[reason];
  }, consecutiveDelay);
  consecutiveAttempts[reason] = { count, timeout };
};

// Common web app templates.
const appHeader = camp.template([
  './templates/header.html',
].concat(!security.forceInsecure ? [] : [
  './templates/header-insecure.html',
]));

const appHeaderNew = camp.template([
  './templates/header-new.html',
].concat(!security.forceInsecure ? [] : [
  './templates/header-insecure.html',
]));

const appFooter = camp.template('./templates/footer.html');
const appFooterNew = camp.template('./templates/footer-new.html');

// Design page
const designSection = camp.template('./templates/design.html');
exports.designPage = function (response, user = null) {
  const title = 'Design';

  response.template({
    title,
    user,
    scripts: []
  }, [
    appHeaderNew,
    designSection,
    appFooterNew
  ]);
};

// new login page
const newLoginSection = camp.template('./templates/login-new.html');
exports.newLoginPage = function (response, user = null) {
  const title = 'Login';

  response.template({
    title,
    user,
    scripts: []
  }, [
    appHeaderNew,
    newLoginSection,
    appFooterNew
  ]);
};

// Public landing page.
const landingSection = camp.template([
  './templates/landing.html',
  './templates/projects.html',
]);
exports.landingPage = function (response, user = null) {
  const title = '';
  const projects = db.get('projects');

  response.template({
    projects,
    title,
    user,
    scripts: [
      '/js/landing.js',
      '/js/timeago-3.0.2.min.js',
      '/js/projects.js',
    ]
  }, [
    appHeader,
    landingSection,
    appFooter
  ]);
};

// Public API reference page.
const apiSection = camp.template('./templates/reference-api.html');
exports.apiPage = function (response, api, user = null) {
  const title = 'API Reference';
  const htmlReference = api.toHTML();

  response.template({
    htmlReference,
    title,
    user,
    scripts: [],
  }, [
    appHeader,
    apiSection,
    appFooter,
  ]);
};

// Public blog page.
const blogSection = camp.template('./templates/blog.html');
exports.blogPage = function (response, user = null) {
  const title = 'Blog';

  response.template({
    title,
    user,
    scripts: [],
  }, [
    appHeader,
    blogSection,
    appFooter,
  ]);
};

// Public blog page.
const blogSectionNew = camp.template('./templates/blog-new.html');
exports.blogPageNew = function (response, user, blog) {
  const title = 'Blog';
  const { topics } = blog.getDb();

  const posts = topics.map(topic => {
    const { title, post_body_html, slug, posts_count } = topic;
    // The newsletter itself counts as a "post" in this "topic".
    // All other posts are comments.
    const comments_count = posts_count - 1;
    const comments_url = comments_count > 0 ? blog.getCommentsUrl(topic) : blog.getPostUrl(topic);
    return { title, post_body_html, slug, comments_count, comments_url };
  });

  response.template({
    posts,
    title,
    user,
    scripts: [],
  }, [
    appHeaderNew,
    blogSectionNew,
    appFooterNew,
  ]);
};

// Public projects list page.
const projectsSection = camp.template([
  './templates/projects.html',
  './templates/projects-hint.html',
]);
exports.projectsPage = function (response, user = null) {
  const title = 'Projects';
  const projects = db.get('projects');

  response.template({
    projects,
    title,
    user,
    scripts: [
      '/js/timeago-3.0.2.min.js',
      '/js/projects.js'
    ],
  }, [
    appHeader,
    projectsSection,
    appFooter,
  ]);
};

// Public project-specific page.
const projectSection = camp.template('./templates/project.html');
exports.projectPage = function (response, project, user = null) {
  const title = project.name;

  response.template({
    project,
    title,
    user,
    scripts: [
      '/js/dygraph-2.0.0.min.js',
      '/js/timeago-3.0.2.min.js',
      '/js/projects.js',
      '/js/graphs.js'
    ],
  }, [
    appHeader,
    projectSection,
    appFooter,
  ]);
};

// User login page.
const loginSection = camp.template('./templates/login.html');
exports.loginPage = function (response) {
  const title = 'Sign In';

  response.template({
    title,
    user: null,
    scripts: [
      '/js/login.js'
    ],
  }, [
    appHeader,
    loginSection,
    appFooter,
  ]);
};

// User containers list.
const containersTemplate = camp.template('./templates/containers.html');
exports.containersPage = function (response, user = null) {
  const title = 'My Containers';
  const projects = db.get('projects');

  response.template({
    projects,
    title,
    user,
    scripts: [
      '/js/timeago-3.0.2.min.js',
      '/js/projects.js'
    ]
  }, [
    appHeader,
    containersTemplate,
    appFooter,
  ]);
};

// User containers list.
const containersTemplateNew = camp.template('./templates/containers-new.html');
exports.containersPageNew = function (response, user = null) {
  const title = 'Containers';
  const projects = db.get('projects');

  response.template({
    projects,
    title,
    user,
    scripts: [
      '/js/timeago-3.0.2.min.js',
      '/js/projects.js'
    ]
  }, [
    appHeaderNew,
    containersTemplateNew,
    appFooterNew,
  ]);
};

// User notifications
const notificationsTemplate = camp.template('./templates/notifications.html');
exports.notificationsPage = function (response, user) {
  const title = 'My Notifications';

  response.template({
    title,
    user,
    scripts: []
  }, [
    appHeader,
    notificationsTemplate,
    appFooter,
  ]);
};

// User settings page.
const settingsHeader = camp.template('./templates/settings-header.html');
const settingsSections = {
  account: camp.template('./templates/settings-account.html'),
  configurations: camp.template('./templates/settings-configurations.html'),
  integrations: camp.template('./templates/settings-integrations.html'),
  notifications: camp.template('./templates/settings-notifications.html'),
};
exports.settingsPage = async function (request, response, section, user) {
  const title = 'Settings';
  const template = settingsSections[section];
  if (!template) {
    // The requested section doesn't exist!
    exports.notFoundPage(response, user);
    return;
  }

  let authorizeUrl;
  try {
    authorizeUrl = await github.getAuthorizationUrl(request);
  } catch (error) {
    log('[fail] could not get github authorization url', error);
  }

  const defaultConfigurations = Object.keys(configurations.defaults);
  const { username } = user.keys.github || {};
  response.template({
    defaultConfigurations,
    github: {
      username,
      authorizeUrl
    },
    section,
    title,
    user,
    scripts: [
      '/js/settings.js'
    ],
  }, [
    appHeader,
    settingsHeader,
    template,
    appFooter,
  ]);
};

// Live data page.
const dataSection = camp.template('./templates/data.html');
exports.dataPage = function (response, user) {
  const title = 'Data';

  metrics.get(data => {
    response.template({
      data,
      title,
      user,
      scripts: [],
    }, [
      appHeader,
      dataSection,
      appFooter,
    ]);
  });
};

// Admin page.
const adminHeader = camp.template('./templates/admin-header.html');
const adminSections = {
  docker: camp.template('./templates/admin-docker.html'),
  hosts: camp.template('./templates/admin-hosts.html'),
  integrations: camp.template('./templates/admin-integrations.html'),
  projects: camp.template('./templates/admin-projects.html'),
  users: camp.template('./templates/admin-users.html'),
};
exports.adminPage = function (response, section, user) {
  const title = 'Admin';
  const template = adminSections[section];
  if (!template) {
    // The requested section doesn't exist!
    exports.notFoundPage(response, user);
    return;
  }

  let hosts = null;
  let oauth2providers = null;
  let projects = null;
  let users = null;
  let waitlist = null;
  switch (section) {
    case 'docker':
      hosts = db.get('hosts');
      users = db.get('users');
      break;

    case 'hosts':
      hosts = db.get('hosts');
      break;

    case 'integrations':
      oauth2providers = db.get('oauth2providers');
      break;

    case 'projects':
      hosts = db.get('hosts');
      projects = db.get('projects');
      break;

    case 'users':
      users = db.get('users');
      waitlist = db.get('waitlist');
      break;
  }

  response.template({
    hosts,
    oauth2providers,
    projects,
    users,
    waitlist,
    section,
    title,
    user,
    scripts: [
      '/js/admin.js',
      '/js/graphs.js',
    ],
  }, [
    appHeader,
    adminHeader,
    template,
    appFooter,
  ]);
};

// 404 Not Found page.
const notFoundSection = camp.template('./templates/404.html');
exports.notFoundPage = function (response, user) {
  const title = 'Page not found!';

  response.statusCode = 404;
  response.template({
    title,
    user,
    scripts: [],
  }, [
    appHeader,
    notFoundSection,
    appFooter,
  ]);
};

// Local web proxy.
exports.webProxy = function (request, response, parameters) {
  // Proxy request to the local port and path.
  const options = {
    hostname: 'localhost',
    port: parameters.port,
    path: parameters.path,
    method: request.method,
    headers: request.headers,
  };
  const proxy = http.request(options);

  proxy.on('response', res => {
    response.writeHead(res.statusCode, res.headers);
    res.pipe(response, { end: true });
  });

  proxy.on('upgrade', (res, socket) => {
    // Rebuild the WebSocket handshake reply from `res`.
    let head = 'HTTP/1.1 ' + res.statusCode + ' ' + res.statusMessage + '\r\n';

    res.rawHeaders.forEach((header, i) => {
      head += header + (i % 2 ? '\r\n' : ': ');
    });

    response.write(head + '\r\n');

    // WebSocket handshake complete, the data transfer begins.
    socket.pipe(response, { end: true });
    response.pipe(socket, { end: true });
  });

  proxy.on('error', error => {
    if (error) {
      log('[fail] could not process the request', error);
    }

    response.statusCode = 503; // Service Unavailable
    response.end();
  });

  // If we already consumed some request data, re-send it through the proxy.
  if (request.savedChunks) {
    proxy.write(request.savedChunks);
  }

  request.pipe(proxy, { end: true });
};
