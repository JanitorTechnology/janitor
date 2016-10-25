// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

let camp = require('@jankeromnes/camp');
let http = require('http');
let path = require('path');

let certificates = require('./lib/certificates');
let db = require('./lib/db');
let docker = require('./lib/docker');
let log = require('./lib/log');
let machines = require('./lib/machines');
let routes = require('./lib/routes');
let users = require('./lib/users');

// Use `make ports` to set up these unprivileged ports.
let ports = {
  http: 1080,
  https: 1443
};


// Permanently redirect all HTTP requests to HTTPS.

let forwarder = http.Server((request, response) => {

  // Make an exception for Let's Encrypt HTTP challenges.
  if (request.url.startsWith(certificates.letsEncryptChallengePrefix)) {
    let token = certificates.getLetsEncryptChallengeToken(request.url);
    if (token) {
      response.end(token);
      return;
    }
  }

  let url = 'https://' + request.headers.host + request.url;
  return routes.redirect(response, url, true);

});

forwarder.listen(ports.http);


// The main Janitor server.

let app = camp.start({
  documentRoot: process.cwd() + '/static',
  port: ports.https,
  secure: true,
  key: 'https.key',
  cert: 'https.crt',
  ca: []
});

let hostname = db.get('hostname', 'localhost');
log('Janitor → https://' + hostname + ':' + ports.https);


// Protect the server and its users with a security policies middleware.

app.handle((request, response, next) => {

  // Only accept requests addressed to our hostname, no IP address or CDN here.
  if (request.headers.host !== hostname) {
    log('dropping request for', request.headers.host);
    response.statusCode = 400;
    response.end();
    return;
  }

  // Tell browsers to only use secure HTTPS connections for this web app.
  response.setHeader('Strict-Transport-Security', 'max-age=31536000');

  // Prevent browsers from accidentally detecting scripts where they shouldn't.
  response.setHeader('X-Content-Type-Options', 'nosniff');

  // Tell browsers this web app should never be embedded into an iframe.
  response.setHeader('X-Frame-Options', 'DENY');

  next();

});


// Authenticate all user requests with a server middleware.

app.handle((request, response, next) => {

  users.get(request, (error, user) => {

    if (error) {
      log('authentication error', String(error));
    }

    request.user = user;
    next();

  });

});


// Public landing page.

app.route(/^\/$/, (data, match, end, query) => {

  var user = query.req.user;

  return routes.landingPage(user, end);

});


// Public blog page.

app.route(/^\/blog\/?$/, (data, match, end, query) => {

  var user = query.req.user;

  log('blog');

  return routes.blogPage(user, end);

});


// Public live data page.

app.route(/^\/data\/?$/, (data, match, end, query) => {

  var user = query.req.user;

  return routes.dataPage(user, end);

});


// Public project pages.

app.route(/^\/projects(\/\w+)?\/?$/, (data, match, end, query) => {

  var user = query.req.user;
  var projectUri = match[1];

  if (!projectUri) {
    // No particular project was requested, show them all.
    return routes.projectsPage(user, end);
  }

  var projectId = projectUri.slice(1);
  var project = db.get('projects')[projectId];

  if (project) {
    // Show the requested project-specific page.
    return routes.projectPage(project, user, end);
  }

    return routes.notFoundPage(user, end, query);


});


// User logout.

app.route(/^\/logout\/?$/, (data, match, end, query) => {

  users.logout(query.req, (error) => {

    if (error) {
      log('logout', String(error));
    }

    return routes.redirect(query.res, '/');

  });

});


// User login.

app.route(/^\/login\/?$/, (data, match, end, query) => {

  var user = query.req.user;

  if (user) {
    return routes.redirect(query.res, '/');
  }

  return routes.loginPage(end);

});


// User contributions list.

app.route(/^\/contributions\/?$/, (data, match, end, query) => {

  var user = query.req.user;

  if (user) {
    return routes.contributionsPage(user, end);
  }

  return routes.loginPage(end);

});


// User settings.

app.route(/^\/settings(\/\w+)?\/?$/, (data, match, end, query) => {

  var user = query.req.user;

  if (!user) {
    return routes.loginPage(end);
  }

  // Select the requested section, or serve the default one.
  var sectionUri = match[1];
  var section = sectionUri ? sectionUri.slice(1) : 'account';

  return routes.settingsPage(section, user, end, query);

});


// User account (now part of settings).

app.route(/^\/account\/?$/, (data, match, end, query) => {

  return routes.redirect(query.res, '/settings/account/', true);

});


// These are not the droids you're looking for.

app.route(/^\/favicon\.ico$/, (data, match, end, query) => {

  return routes.redirect(query.res, '/img/janitor.svg', true);

});


// Admin sections.

app.route(/^\/admin(\/\w+)?\/?$/, (data, match, end, query) => {

  var user = query.req.user;

  if (!users.isAdmin(user)) {
    return routes.notFoundPage(user, end, query);
  }

  // Select the requested section, or serve the default one.
  var sectionUri = match[1];
  var section = sectionUri ? sectionUri.slice(1) : 'hosts';

  log('admin', section, '(' + user.email + ')');

  return routes.adminPage(section, user, end, query);

});


// Secure VNC connection proxy.

app.route(/^\/vnc\/(\w+)\/(\d+)(\/.*)$/, (data, match, end, query) => {

  var user = query.req.user;

  if (!user) {
    return routes.notFoundPage(user, end, query);
  }

  var projectId = match[1];
  var machineId = parseInt(match[2]);
  var uri = path.normalize(match[3]);

  log('vnc', projectId, machineId, uri);

  var machine = machines.getMatchingMachine(projectId, machineId, user);

  if (machine) {
    // Remember this machine for the websocket proxy (see below).
    user.lastvnc = {
      project: projectId,
      machine: machineId
    };
    return routes.vncProxy(user, machine, end, query, uri);
  }

  return routes.notFoundPage(user, end, query);

});


// Secure WebSocket proxy for VNC connections.

app.on('upgrade', (request, socket, head) => {

  if (request.url !== '/websockify') {
    return socket.end();
  }

  // Authenticate the user (our middleware only works for 'request' events).
  users.get(request, (error, user) => {

    if (!user || !user.lastvnc) {
      return socket.end();
    }

    // Get the last machine that the user VNC'd into (a hack, but it works).
    // Note: Parsing the URL in `request.headers.referer` would be better, but
    // that header never seems to be set on WebSocket requests.
    var projectId = user.lastvnc.project;
    var machineId = user.lastvnc.machine;
    var machine = machines.getMatchingMachine(projectId, machineId, user);

    log('vnc-websocket', projectId, machineId);

    if (machine) {
      return routes.vncSocketProxy(machine, request, socket, head);
    }

    return socket.end();

  });

});


// 404 Not Found.

app.notfound(/.*/, (data, match, end, query) => {

  var user = query.req.user;

  log('404', match[0]);

  return routes.notFoundPage(user, end, query);

});


// Alpha version sign-up.

app.ajax.on('signup', (data, end) => {

  var email = data.email;
  var users = db.get('users');
  var waitlist = db.get('waitlist');

  log('signup', email);

  if (waitlist[email]) {
    return end({ status: 'already-added' });
  }

  if (users[email]) {
    return end({ status: 'already-invited' });
  }

  waitlist[email] = Date.now();
  db.save();

  return end({ status: 'added' });

});


// Alpha version invite.

app.ajax.on('invite', (data, end, query) => {

  var user = query.req.user;

  if (!users.isAdmin(user)) {
    return end();
  }

  var email = data.email;

  if (email in db.get('users')) {
    return end({ status: 'already-invited' });
  }

  users.sendInviteEmail(email, (error) => {
    if (error) {
      var message = String(error);
      log(message, '(while inviting ' + email + ')');
      return end({ status: 'error', message: message });
    }
    return end({ status: 'invited' });
  });

});


// Request a log-in key via email.

app.ajax.on('login', (data, end, query) => {

  var user = query.req.user;

  if (user) {
    end({ status: 'logged-in' });
    return;
  }

  var email = data.email;

  users.sendLoginEmail(email, query.req, (error) => {
    if (error) {
      var message = String(error);
      log(message, '(while emailing ' + email + ')');
      return end({ status: 'error', message: message });
    }
    return end({ status: 'email-sent' });
  });

});


// Change the configuration of a Docker host.

app.ajax.on('hostdb', (data, end, query) => {

  var user = query.req.user;

  if (!users.isAdmin(user)) {
    return end();
  }

  if (!data.id) {
    return end({ status: 'error', message: 'Invalid Host ID' });
  }

  docker.setHost(data);

  return end({ status: 'success' });

});


// Change the parameters of a project.

app.ajax.on('projectdb', (data, end, query) => {

  var user = query.req.user;

  if (!users.isAdmin(user)) {
    return end();
  }

  if (!data.id) {
    return end({ status: 'error', message: 'Invalid Project ID' });
  }

  machines.setProject(data);

  return end({ status: 'success' });

});


// Rebuild the base image of a project.

app.ajax.on('rebuild', (data, end, query) => {

  var user = query.req.user;

  if (!users.isAdmin(user)) {
    return end();
  }

  machines.rebuild(data.project, (error) => {
    if (error) {
      return end({ status: 'error', message: String(error) });
    }
    return end({ status: 'success' });
  });

  // For longer requests, make sure we reply before the browser retries.
  setTimeout(() => {
    return end({ status: 'started' });
  }, 42000);

});


// Update the base image of a project.

app.ajax.on('update', (data, end, query) => {

  var user = query.req.user;

  if (!users.isAdmin(user)) {
    return end();
  }

  machines.update(data.project, (error) => {
    if (error) {
      return end({ status: 'error', message: String(error) });
    }
    return end({ status: 'success' });
  });

  // For longer requests, make sure we reply before the browser retries.
  setTimeout(() => {
    return end({ status: 'started' });
  }, 42000);

});


// Spawn a new machine for a project. (Fast!)

app.ajax.on('spawn', (data, end, query) => {

  var user = query.req.user;

  if (!user) {
    return end({ status: 'error', message: 'Not signed in' });
  }

  machines.spawn(data.project, user, (error) => {
    if (error) {
      return end({ status: 'error', message: String(error) });
    }
    return end({ status: 'success' });
  });

});


// Destroy a machine.

app.ajax.on('destroy', (data, end, query) => {

  var user = query.req.user;

  if (!user) {
    return end({ status: 'error', message: 'Not signed in' });
  }

  machines.destroy(data.machine, data.project, user, (error) => {
    if (error) {
      return end({ status: 'error', message: String(error) });
    }
    return end({ status: 'success' });
  });

});


// Save a new user key, or update an existing one.

app.ajax.on('key', (data, end, query) => {

  var user = query.req.user;

  if (!user || !data.name || !data.key) {
    return end();
  }

  var key = '';

  switch (data.name) {

    case 'cloud9':
      // Extract a valid SSH public key from the user's input.
      // Regex adapted from https://gist.github.com/paranoiq/1932126.
      var match = data.key.match(/ssh-rsa [\w+\/]+[=]{0,3}/);
      if (!match) {
        return end({ status: 'error', message: 'Invalid SSH key' });
      }
      key = match[0];
      log('key', data.name, user.email);
      break;

    case 'cloud9user':
      // Cloud9 usernames consist of lowercase letters, numbers and '_' only.
      var match = data.key.trim().match(/^[a-z0-9_]+$/);
      if (!match) {
        return end({ status: 'error', message: 'Invalid Cloud9 username' });
      }
      key = match[0];
      log('key', data.name, user.email, key);
      break;

    default:
      return end({ status: 'error', message: 'Unknown key name' });

  }

  user.keys[data.name] = key;
  db.save();

  return end({ status: 'key-saved' });

});


// Teach the template system how to generate IDs (matching /[a-z0-9_-]*/).

camp.templateReader.parsers.id = (text) => {
  return text.replace(/[^\w-]/g, '').toLowerCase();
};
