// Copyright © 2015 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

var http = require('http');

var db = require('./db');
var machines = require('./machines');
var metrics = require('./metrics');


// Redirect to a target url.

function redirect (response, url, permanently) {

  response.statusCode = permanently ? 301 : 302;
  response.setHeader('Location', url);
  response.end();

}

exports.redirect = redirect;


// Public landing page.

function landingPage (user, end) {

  var title = '';
  var hosts = db.get('hosts');
  var projects = db.get('projects');

  end({
    hosts: hosts,
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

}

exports.landingPage = landingPage;


// Public blog page.

function blogPage (user, end) {

  var title = 'Blog';

  end({
    title: title,
    user: user,
    scripts: []
  }, { template: [
    '../templates/header.html',
    '../templates/blog.html',
    '../templates/footer.html'
  ]});

}

exports.blogPage = blogPage;


// Public projects page.

function projectsPage (user, end) {

  var title = 'Projects';
  var hosts = db.get('hosts');
  var projects = db.get('projects');

  end({
    hosts: hosts,
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

}

exports.projectsPage = projectsPage;


// Public project-specific page.

function projectPage (project, user, end) {

  var title = project.name;

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

}

exports.projectPage = projectPage;


// User login page.

function loginPage (end) {

  var title = 'Sign In';

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

}

exports.loginPage = loginPage;


// User contributions list.

function contributionsPage (user, end) {

  var title = 'My Contributions';
  var hosts = db.get('hosts');
  var projects = db.get('projects');

  end({
    hosts: hosts,
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

}

exports.contributionsPage = contributionsPage;


// User settings page.

function settingsPage (section, user, end, query) {

  var title = 'Settings';
  var template = null;

  switch (section) {

    case 'account':
      template = '../templates/settings-account.html';
      break;

    default:
      // The requested section doesn't exist!
      return notFoundPage(user, end, query);

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

}

exports.settingsPage = settingsPage;


// Live data page.

function dataPage (user, end) {

  var title = 'Data';

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

}

exports.dataPage = dataPage;


// Admin page.

function adminPage (section, user, end, query) {

  var title = 'Admin';
  var hosts = null;
  var projects = null;
  var users = null;
  var waitlist = null;
  var template = null;

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
      return notFoundPage(user, end, query);

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

}

exports.adminPage = adminPage;


// 404 Not Found page.

function notFoundPage (user, end, query) {

  var title = 'Page not found!';

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

}

exports.notFoundPage = notFoundPage;


// Local VNC connection proxy.

function vncProxy (user, machine, end, query, uri) {

  var request = query.req;
  var response = query.res;

  var options = {
    hostname: 'localhost',
    port: machine.docker.ports['8088'],
    path: uri,
    method: request.method,
    headers: request.headers
  };

  // Proxy request to the local VNC port.
  var proxy = http.request(options, function (res) {
    response.writeHead(res.statusCode, res.headers);
    res.pipe(response, { end: true });
  });

  proxy.on('error', function (error) {
    return notFoundPage(user, end, query);
  });

  request.pipe(proxy, { end: true });

}

exports.vncProxy = vncProxy;


// Local WebSocket proxy for VNC connections.

function vncSocketProxy (machine, request, socket) {

  var options = {
    hostname: 'localhost',
    port: machine.docker.ports['8088'],
    path: request.url,
    method: request.method,
    headers: request.headers
  };

  var proxy = http.request(options);

  proxy.on('upgrade', function (res, sock) {

    // Rebuild the WebSocket handshake reply from `res`.
    var head = 'HTTP/1.1 ' + res.statusCode + ' ' + res.statusMessage + '\r\n';

    res.rawHeaders.forEach(function (header, i) {
      head += header + (i%2 ? '\r\n' : ': ');
    });

    socket.write(head + '\r\n');

    // WebSocket handshake complete, the data transfer begins.
    sock.pipe(socket, { end: true });
    socket.pipe(sock, { end: true });

  });

  proxy.on('error', function (error) {
    return socket.end();
  });

  request.pipe(proxy);

}

exports.vncSocketProxy = vncSocketProxy;
