// Copyright © 2015 Jan Keromnes. All rights reserved.
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
].concat(!security.forceInsecure ? [] : [
  './templates/header-insecure.html',
]));

const appHeaderNew = camp.template([
  './templates/header-new.html',
].concat(!security.forceInsecure ? [] : [
  './templates/header-insecure-new.html',
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
    scripts: [],
    stylesheets: [],
  }, [
    appHeaderNew,
    designSection,
    appFooterNew,
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
    timeago,
    title,
    user,
    scripts: [
      '/js/landing.js',
      '/js/timeago-3.0.2.min.js',
      '/js/projects.js',
    ],
    stylesheets: [],
  }, [
    appHeader,
    landingSection,
    appFooter,
  ]);
};

// New public landing page.
const landingSectionNew = camp.template([
  './templates/landing-new.html',
  './templates/projects-new.html',
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
  'Open pull requests',
  'Get contributions',
  'Onboard new people',
  'Run hackathons',
  'Grow your team',
  'Grow your community',
  'Understand projects',
  'Hack software',
  'Bootstrap',
  'Get started',
  'Get better tools',
  'Learn software',
  'Teach software',
  'Learn coding',
  'Teach coding',
]; // + 'faster'
exports.landingPageNew = function (response, user = null) {
  const title = '';
  const projects = db.get('projects');

  response.template({
    projects,
    taglines: landingTaglines,
    timeago,
    title,
    user,
    scripts: [
      '/js/landing.js',
      '/js/timeago-3.0.2.min.js',
      '/js/projects.js',
    ]
  }, [
    appHeaderNew,
    landingSectionNew,
    appFooterNew
  ]);
};

// New public landing page.
const landingSectionNew = camp.template([
  './templates/landing-new.html',
  './templates/projects-new.html',
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
  'Open pull requests',
  'Get contributions',
  'Onboard new people',
  'Run hackathons',
  'Grow your team',
  'Grow your community',
  'Understand projects',
  'Hack software',
  'Bootstrap',
  'Get started',
  'Get better tools',
  'Learn software',
  'Teach software',
  'Learn coding',
  'Teach coding',
]; // + 'faster'
exports.landingPageNew = function (response, user = null) {
  const title = '';
  const projects = db.get('projects');

  response.template({
    projects,
    taglines: landingTaglines,
    timeago,
    title,
    user,
    scripts: [
      '/js/landing.js',
      '/js/timeago-3.0.2.min.js',
      '/js/projects.js',
    ]
  }, [
    appHeaderNew,
    landingSectionNew,
    appFooterNew
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
    stylesheets: [],
  }, [
    appHeader,
    apiSection,
    appFooter,
  ]);
};

// New Public API reference page.
const apiSectionNew = camp.template('./templates/reference-api-new.html');
exports.apiPageNew = function (response, api, user = null) {
  const title = 'API Reference';
  const htmlReference = api.toHTML();

  response.template({
    htmlReference,
    title,
    user,
    scripts: [],
    stylesheets: [
      '/css/api-reference.css'
    ],
  }, [
    appHeaderNew,
    apiSectionNew,
    appFooterNew,
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
    stylesheets: [],
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
    scripts: [
      '/js/blog-new.js'
    ],
    stylesheets: [
      '/css/blog.css'
    ],
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
    timeago,
    title,
    user,
    scripts: [
      '/js/timeago-3.0.2.min.js',
      '/js/projects.js'
    ],
    stylesheets: [],
  }, [
    appHeader,
    projectsSection,
    appFooter,
  ]);
};

// New public projects list page.
const projectsSectionNew = camp.template([
  './templates/projects-new.html'
]);
exports.projectsPageNew = function (response, user = null) {
  const title = 'Projects';
  const projects = db.get('projects');

  response.template({
    projects,
    timeago,
    title,
    user,
    scripts: [
      '/js/timeago-3.0.2.min.js',
      '/js/projects.js'
    ],
    stylesheets: [],
  }, [
    appHeaderNew,
    projectsSectionNew,
    appFooterNew,
  ]);
};

// Public project-specific page.
const projectSection = camp.template('./templates/project.html');
exports.projectPage = function (response, project, user = null) {
  const title = project.name;

  response.template({
    project,
    timeago,
    title,
    user,
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

// New Public project-specific page.
const projectSectionNew = camp.template('./templates/project-new.html');
exports.projectPageNew = function (response, project, user = null) {
  const title = project.name;

  response.template({
    project,
    timeago,
    title,
    user,
    scripts: [
      '/js/dygraph-2.0.0.min.js',
      '/js/timeago-3.0.2.min.js',
      '/js/projects.js',
      '/js/graphs.js'
    ],
    stylesheets: [],
  }, [
    appHeaderNew,
    projectSectionNew,
    appFooterNew,
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
    stylesheets: [],
  }, [
    appHeader,
    loginSection,
    appFooter,
  ]);
};

// New User login page
const newLoginSection = camp.template('./templates/login-new.html');
exports.newLoginPage = function (response, user = null) {
  const title = 'Log In';

  response.template({
    title,
    user,
    scripts: [],
    stylesheets: [],
  }, [
    appHeaderNew,
    newLoginSection,
    appFooterNew,
  ]);
};

// User containers list.
const containersTemplate = camp.template('./templates/containers.html');
exports.containersPage = function (response, user = null) {
  const title = 'My Containers';
  const projects = db.get('projects');

  response.template({
    projects,
    timeago,
    title,
    user,
    scripts: [
      '/js/timeago-3.0.2.min.js',
      '/js/projects.js'
    ],
    stylesheets: [],
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
    timeago,
    title,
    user,
    scripts: [
      '/js/timeago-3.0.2.min.js',
      '/js/projects.js'
    ],
    stylesheets: [
      '/css/containers.css'
    ],
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
    scripts: [],
    stylesheets: [],
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
    scripts: [],
    stylesheets: [],
  }, [
    appHeader,
    settingsHeader,
    template,
    appFooter,
  ]);
};

// New settings page
const settingsTemplateNew = camp.template('./templates/settings-new.html');
exports.settingsPageNew = async function (request, response, user) {
  const title = 'Settings';

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
    scripts: [],
    stylesheets: [
      '/css/settings.css'
    ],
  }, [
    appHeaderNew,
    settingsTemplateNew,
    appFooterNew,
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
      stylesheets: [],
    }, [
      appHeader,
      dataSection,
      appFooter,
    ]);
  });
};

// New Live data page.
const dataSectionNew = camp.template('./templates/data-new.html');
exports.dataPageNew = function (response, user) {
  const title = 'Data';

  metrics.get(data => {
    response.template({
      data,
      title,
      user,
      scripts: [],
      stylesheets: [
        '/css/data.css'
      ],
    }, [
      appHeaderNew,
      dataSectionNew,
      appFooterNew,
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
    scripts: [
      '/js/admin.js',
      '/js/graphs.js',
    ],
    stylesheets: [],
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
    stylesheets: [],
  }, [
    appHeader,
    notFoundSection,
    appFooter,
  ]);
};

// New 404 Not Found page.
const notFoundSectionNew = camp.template('./templates/404-new.html');
exports.notFoundPageNew = function (response, user) {
  const title = 'Page not found';

  response.statusCode = 404;
  response.template({
    title,
    user,
    scripts: [],
    stylesheets: [],
  }, [
    appHeaderNew,
    notFoundSectionNew,
    appFooterNew,
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
