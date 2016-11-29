// Copyright © 2015 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

let http = require('http');

let db = require('./db');
let machines = require('./machines');
let metrics = require('./metrics');

// Redirect to a target url.
exports.redirect = function (response, url, permanently) {
  response.statusCode = permanently ? 301 : 302;
  response.setHeader('Location', url);
  response.end();
};

// Public landing page.
exports.landingPage = function (user, end) {
  let title = '';
  let projects = db.get('projects');

  end({
    machines: user ? machines.getAvailableMachines(user) : null,
    projects: projects,
    title: title,
    user: user,
    scripts: [
      '/js/landing.js',
      '/js/jquery.timeago.js',
      '/js/projects.js'
    ]
  }, { template: [
    '../templates/header.html',
    '../templates/landing.html',
    '../templates/projects.html',
    '../templates/footer.html'
  ]});
};

// Public blog page.
exports.blogPage = function (user, end) {
  let title = 'Blog';

  end({
    title: title,
    user: user,
    scripts: []
  }, { template: [
    '../templates/header.html',
    '../templates/blog.html',
    '../templates/footer.html'
  ]});
};

// Public projects page.
exports.projectsPage = function (user, end) {
  let title = 'Projects';
  let projects = db.get('projects');

  end({
    machines: user ? machines.getAvailableMachines(user) : null,
    projects: projects,
    title: title,
    user: user,
    scripts: [
      '/js/jquery.timeago.js',
      '/js/projects.js'
    ]
  }, { template: [
    '../templates/header.html',
    '../templates/projects.html',
    '../templates/projects-hint.html',
    '../templates/footer.html'
  ]});
};

// Public project-specific page.
exports.projectPage = function (project, user, end) {
  let title = project.name;

  end({
    project: project,
    title: title,
    user: user,
    scripts: [
      '/js/dygraph-combined.js',
      '/js/jquery.timeago.js',
      '/js/projects.js',
      '/js/graphs.js'
    ]
  }, { template: [
    '../templates/header.html',
    '../templates/project.html',
    '../templates/footer.html'
  ]});
};

// User login page.
exports.loginPage = function (end) {
  let title = 'Sign In';

  end({
    title: title,
    user: null,
    scripts: [
      '/js/login.js'
    ]
  }, { template: [
    '../templates/header.html',
    '../templates/login.html',
    '../templates/footer.html'
  ]});
};

// User contributions list.
exports.contributionsPage = function (user, end) {
  let title = 'My Contributions';
  let projects = db.get('projects');

  end({
    projects: projects,
    title: title,
    user: user,
    scripts: [
      '/js/jquery.timeago.js',
      '/js/projects.js'
    ]
  }, { template: [
    '../templates/header.html',
    '../templates/contributions.html',
    '../templates/footer.html'
  ]});
};

// User settings page.
exports.settingsPage = function (section, user, end, query) {
  let title = 'Settings';
  let template = null;

  switch (section) {
    case 'account':
      template = '../templates/settings-account.html';
      break;

    default:
      // The requested section doesn't exist!
      exports.notFoundPage(user, end, query);
      return;
  }

  end({
    section: section,
    title: title,
    user: user,
    scripts: [
      '/js/settings.js'
    ]
  }, { template: [
    '../templates/header.html',
    template,
    '../templates/settings-hint.html',
    '../templates/footer.html'
  ]});
};

// Live data page.
exports.dataPage = function (user, end) {
  let title = 'Data';

  metrics.get(function (data) {
    end({
      data: data,
      title: title,
      user: user,
      scripts: []
    }, { template: [
      '../templates/header.html',
      '../templates/data.html',
      '../templates/footer.html'
    ]});
  });
};

// Admin page.
exports.adminPage = function (section, user, end, query) {
  let title = 'Admin';
  let hosts = null;
  let projects = null;
  let users = null;
  let waitlist = null;
  let template = null;

  switch (section) {
    case 'hosts':
      hosts = db.get('hosts');
      template = '../templates/admin-hosts.html';
      break;

    case 'projects':
      hosts = db.get('hosts');
      projects = db.get('projects');
      template = '../templates/admin-projects.html';
      break;

    case 'users':
      users = db.get('users');
      waitlist = db.get('waitlist');
      template = '../templates/admin-users.html';
      break;

    default:
      // The requested section doesn't exist!
      exports.notFoundPage(user, end, query);
      return;
  }

  end({
    hosts: hosts,
    projects: projects,
    users: users,
    waitlist: waitlist,
    section: section,
    title: title,
    user: user,
    scripts: [
      '/js/admin.js'
    ]
  }, { template: [
    '../templates/header.html',
    '../templates/admin-header.html',
    template,
    '../templates/footer.html'
  ]});
};

// 404 Not Found page.
exports.notFoundPage = function (user, end, query) {
  let title = 'Page not found!';

  query.res.statusCode = 404;

  end({
    title: title,
    user: user,
    scripts: []
  }, { template: [
    '../templates/header.html',
    '../templates/404.html',
    '../templates/footer.html'
  ]});
};

// Local web proxy.
exports.webProxy = function (parameters, request, response) {
  // Proxy request to the local port and path.
  let options = {
    hostname: 'localhost',
    port: parameters.port,
    path: parameters.path,
    method: request.method,
    headers: request.headers
  };
  let proxy = http.request(options);

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
    response.statusCode = 503; // Service Unavailable
    response.end();
  });

  request.pipe(proxy, { end: true });
};
