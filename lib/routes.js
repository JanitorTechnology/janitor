// Copyright © 2015 Team Janitor. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const camp = require('camp');
const http = require('http');
const timeago = require('timeago.js');

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
  return '/' + text.replace(/~/g, '~0').replace(/\//g, '~1');
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
].concat(!security.forceInsecure
  ? []
  : [
      './templates/header-insecure.html',
    ]));

const appHeaderOld = camp.template([
  './templates/header-old.html',
].concat(!security.forceInsecure
  ? []
  : [
      './templates/header-insecure-old.html',
    ]));

const appFooter = camp.template('./templates/footer.html');
const appFooterOld = camp.template('./templates/footer-old.html');

// About Page.
const aboutSection = camp.template('./templates/about.html');
exports.aboutPage = function (request, response) {
  const { user, canonicalUrl } = request;
  const title = 'About';

  response.template({
    title,
    user,
    canonicalUrl,
    scripts: [],
    stylesheets: [],
  }, [
    appHeader,
    aboutSection,
    appFooter,
  ]);
};

// Design page.
const designSection = camp.template('./templates/design.html');
exports.designPage = function (request, response) {
  const { user, canonicalUrl } = request;
  const title = 'Design';

  response.template({
    title,
    user,
    canonicalUrl,
    scripts: [],
    stylesheets: [],
  }, [
    appHeader,
    designSection,
    appFooter,
  ]);
};

// Public landing page.
const landingSection = camp.template([
  './templates/landing.html',
]);
const landingTaglines = [
  'Fix bugs',
  'Review code',
  'Migrate code',
  'Refactor code',
  'Fix technical debt',
  'Investigate bugs',
  'Debug stuff',
  'Implement stuff',
  'Try new ideas',
  'Build prototypes',
  'Contribute',
  'Send patches',
  'Send pull requests',
  'Get contributions',
  'Onboard new people',
  'Run hackathons',
  'Grow your team',
  'Grow your community',
  'Understand projects',
  'Hack software',
  'Bootstrap',
  'Build',
  'Get started',
  'Get better tools',
  'Learn software',
  'Teach software',
  'Learn coding',
  'Teach coding',
]; // + 'faster'
exports.landingPage = function (request, response) {
  const title = '';
  const projects = db.get('projects');
  const { user, canonicalUrl } = request;

  response.template({
    projects,
    taglines: landingTaglines,
    timeago,
    title,
    user,
    canonicalUrl,
    scripts: [
      '/js/timeago-3.0.2.min.js',
    ],
    stylesheets: [
      '/css/landing.css',
    ]
  }, [
    appHeader,
    landingSection,
    appFooter
  ]);
};

// Public API reference page.
const apiSection = camp.template('./templates/reference-api.html');
exports.apiPage = function (request, response, api) {
  const { user, canonicalUrl } = request;
  const title = 'API Reference';
  const htmlReference = api.toHTML();

  response.template({
    htmlReference,
    title,
    user,
    canonicalUrl,
    scripts: [],
    stylesheets: [
      '/css/api-reference.css'
    ],
  }, [
    appHeader,
    apiSection,
    appFooter,
  ]);
};

// Public blog page.
const blogSection = camp.template('./templates/blog.html');
exports.blogPage = function (request, response, blog) {
  const title = 'Blog';
  const { topics } = blog.getDb();
  const { user, canonicalUrl } = request;

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
    canonicalUrl,
    scripts: [
      '/js/blog.js'
    ],
    stylesheets: [
      '/css/blog.css'
    ],
  }, [
    appHeader,
    blogSection,
    appFooter,
  ]);
};

// Public projects list page.
const projectsSection = camp.template([
  './templates/projects.html'
]);
exports.projectsPage = function (request, response) {
  const { user, canonicalUrl } = request;
  const title = 'Projects';
  const projects = db.get('projects');

  response.template({
    projects,
    timeago,
    title,
    user,
    canonicalUrl,
    scripts: [
      '/js/timeago-3.0.2.min.js',
      '/js/projects.js'
    ],
    stylesheets: [
      '/css/projects.css'
    ],
  }, [
    appHeader,
    projectsSection,
    appFooter,
  ]);
};

// Public project-specific page.
const projectSection = camp.template('./templates/project.html');
exports.projectPage = function (request, response, project) {
  const { user, canonicalUrl } = request;
  const title = project.name;

  response.template({
    project,
    timeago,
    title,
    user,
    canonicalUrl,
    scripts: [
      '/js/dygraph-2.0.0.min.js',
      '/js/timeago-3.0.2.min.js',
      '/js/projects.js',
      '/js/graphs.js'
    ],
    stylesheets: [],
  }, [
    appHeader,
    projectSection,
    appFooter,
  ]);
};

// User login page
const loginSection = camp.template('./templates/login.html');
exports.loginPage = function (request, response) {
  const title = 'Log In';
  const { user, canonicalUrl } = request;

  response.template({
    title,
    user,
    canonicalUrl,
    scripts: [],
    stylesheets: [],
  }, [
    appHeader,
    loginSection,
    appFooter,
  ]);
};

// User containers list.
const containersTemplate = camp.template('./templates/containers.html');
exports.containersPage = function (request, response) {
  const title = 'Containers';
  const projects = db.get('projects');
  const { user, canonicalUrl } = request;

  response.template({
    projects,
    timeago,
    title,
    user,
    canonicalUrl,
    scripts: [
      '/js/timeago-3.0.2.min.js',
      '/js/projects.js'
    ],
    stylesheets: [
      '/css/containers.css'
    ],
  }, [
    appHeader,
    containersTemplate,
    appFooter,
  ]);
};

// User notifications
const notificationsTemplate = camp.template('./templates/notifications.html');
exports.notificationsPage = function (request, response) {
  const { user, canonicalUrl } = request;
  const title = 'My Notifications';

  response.template({
    title,
    user,
    canonicalUrl,
    scripts: [],
    stylesheets: [],
  }, [
    appHeaderOld,
    notificationsTemplate,
    appFooterOld,
  ]);
};

// Old user settings page.
const settingsHeaderOld = camp.template('./templates/settings-header.html');
const settingsSectionsOld = {
  account: camp.template('./templates/settings-account.html'),
  configurations: camp.template('./templates/settings-configurations.html'),
  integrations: camp.template('./templates/settings-integrations.html'),
  notifications: camp.template('./templates/settings-notifications.html'),
};
exports.settingsPageOld = async function (request, response, section) {
  const { user, canonicalUrl } = request;
  const title = 'Settings';
  const template = settingsSectionsOld[section];
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
    canonicalUrl,
    scripts: [],
    stylesheets: [],
  }, [
    appHeaderOld,
    settingsHeaderOld,
    template,
    appFooterOld,
  ]);
};

// User settings page.
const settingsTemplate = camp.template('./templates/settings.html');
exports.settingsPage = async function (request, response) {
  const title = 'Settings';
  const { user, canonicalUrl } = request;

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
    title,
    user,
    canonicalUrl,
    scripts: [],
    stylesheets: [
      '/css/settings.css'
    ],
  }, [
    appHeader,
    settingsTemplate,
    appFooter,
  ]);
};

// Live data page.
const dataSection = camp.template('./templates/data.html');
exports.dataPage = function (request, response) {
  const { user, canonicalUrl } = request;
  const title = 'Data';

  metrics.get(data => {
    response.template({
      data,
      title,
      user,
      canonicalUrl,
      scripts: [],
      stylesheets: [
        '/css/data.css'
      ],
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
exports.adminPage = function (request, response, section) {
  const { user, canonicalUrl } = request;
  const title = 'Admin';
  const template = adminSections[section];
  if (!template) {
    // The requested section doesn't exist!
    exports.notFoundPage(response, user);
    return;
  }

  let azure = null;
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
      azure = db.get('azure');
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
    azure,
    hosts,
    oauth2providers,
    projects,
    users,
    waitlist,
    section,
    title,
    user,
    canonicalUrl,
    scripts: [
      '/js/admin.js',
      '/js/graphs.js',
    ],
    stylesheets: [],
  }, [
    appHeaderOld,
    adminHeader,
    template,
    appFooterOld,
  ]);
};

// 404 Not Found page.
const notFoundSection = camp.template('./templates/404.html');
exports.notFoundPage = function (request, response) {
  const { user, canonicalUrl } = request;
  const title = 'Page not found';

  response.statusCode = 404;
  response.template({
    title,
    user,
    canonicalUrl,
    scripts: [],
    stylesheets: [],
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
