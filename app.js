// Copyright © 2015 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

var camp = require('camp');
var http = require('http');
var path = require('path');

var db = require('./lib/db');
var docker = require('./lib/docker');
var log = require('./lib/log');
var machines = require('./lib/machines');
var routes = require('./lib/routes');
var users = require('./lib/users');

// Use `make ports` to set up these unprivileged ports.
var ports = {
  http: 1080,
  https: 1443
};


// Permanently redirect all HTTP requests to HTTPS.

var forwarder = http.Server(function (req, res) {
  res.writeHead(301, { 'Location': 'https://' + req.headers.host + req.url });
  res.end();
});

forwarder.listen(ports.http);


// The main Janitor server.

var app = camp.start({
  documentRoot: process.cwd() + '/static',
  port: ports.https,
  secure: true,
  key: 'https.key',
  cert: 'https.crt',
  ca: []
});

log('Janitor →  https://localhost' + (ports.https === 443 ? '' : ':' + ports.https));


// Public landing page.

app.route(/^\/$/, function (data, match, end, query) {

  users.get(data, query, function (error, user) {
    return routes.landingPage(user, end);
  });

});


// Public blog page.

app.route(/^\/blog\/?$/, function (data, match, end, query) {

  log('blog');

  users.get(data, query, function (error, user) {
    return routes.blogPage(user, end);
  });

});


// Public live data page.

app.route(/^\/data\/?$/, function (data, match, end, query) {

  users.get(data, query, function (error, user) {
    return routes.dataPage(user, end);
  });

});


// Public project pages.

app.route(/^\/projects(\/\w+)?\/?$/, function (data, match, end, query) {

  users.get(data, query, function (error, user) {

    var uri = match[1];

    if (!uri) {
      // No particular project was requested, show them all.
      return routes.projectsPage(user, end);
    }

    var projectId = uri.slice(1);
    var project = db.get('projects')[projectId];

    if (project) {
      // Show the requested project-specific page.
      return routes.projectPage(project, user, end);
    }

    return routes.notFoundPage(user, end, query);

  });

});


// User logout.

app.route(/^\/logout\/?$/, function (data, match, end, query) {

  users.logout(query, function (error) {

    if (error) {
      log('logout', error.toString());
    }

    return routes.redirect(query, '/');

  });

});


// User login.

app.route(/^\/login\/?$/, function (data, match, end, query) {

  users.get(data, query, function (error, user) {

    if (user) {
      return routes.redirect(query, '/');
    }

    return routes.loginPage(end);

  });

});


// User contributions list.

app.route(/^\/contributions\/?$/, function (data, match, end, query) {

  users.get(data, query, function (error, user) {

    if (user) {
      return routes.contributionsPage(user, end);
    }

    return routes.loginPage(end);

  });

});


// User account.

app.route(/^\/account\/?$/, function (data, match, end, query) {

  users.get(data, query, function (error, user) {

    if (user) {
      return routes.accountPage(user, end);
    }

    return routes.loginPage(end);

  });

});


// Admin sections.

app.route(/^\/admin(\/\w+)?\/?$/, function (data, match, end, query) {

  users.get(data, query, function (error, user) {

    if (!users.isAdmin(user)) {
      return routes.notFoundPage(user, end, query);
    }

    // Select the requested section, or serve the default one.
    var uri = match[1];
    var section = uri ? uri.slice(1) : 'hosts';

    log('admin', section, '(' + user.email + ')');

    return routes.adminPage(section, user, end, query);

  });

});


// Secure VNC connection proxy.

app.route(/^\/vnc\/(\w+)\/(\d+)(\/.*)$/, function (data, match, end, query) {

  users.get(data, query, function (error, user) {

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

});


// Secure WebSocket proxy for VNC connections.

app.on('upgrade', function (request, socket, head) {

  if (request.url !== '/websockify') {
    return socket.end();
  }

  // Mock an empty `data` and a partial `query` just to find the user.
  users.get({ }, { req: request }, function (error, user) {

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

app.notfound(/.*/, function (data, match, end, query) {

  log('404', match[0]);

  users.get(data, query, function (error, user) {
    return routes.notFoundPage(user, end, query);
  });

});


// Alpha version sign-up.

app.ajax.on('signup', function (data, end) {

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

app.ajax.on('invite', function (data, end, query) {

  users.get(data, query, function (error, user) {

    if (!users.isAdmin(user)) {
      return end();
    }

    var email = data.email;

    if (email in db.get('users')) {
      return end({ status: 'already-invited' });
    }

    users.sendInviteEmail(email, query, function (error) {
      if (error) {
        var message = error.toString();
        log(message, '(while inviting ' + email + ')');
        return end({ status: 'error', message: message });
      }
      return end({ status: 'invited' });
    });

  });

});


// Request a log-in key via email.

app.ajax.on('login', function (data, end, query) {

  users.get(data, query, function (error, user) {

    if (user) {
      end({ status: 'logged-in' });
      return;
    }

    var email = data.email;

    users.sendLoginEmail(email, query, function (error) {
      if (error) {
        var message = error.toString();
        log(message, '(while emailing ' + email + ')');
        return end({ status: 'error', message: message });
      }
      return end({ status: 'email-sent' });
    });

  });

});


// Change the configuration of a Docker host.

app.ajax.on('hostdb', function (data, end, query) {

  users.get(data, query, function (error, user) {

    if (!users.isAdmin(user)) {
      return end();
    }

    if (!data.id) {
      return end({ status: 'error', message: 'Invalid Host ID' });
    }

    docker.setHost(data);

    return end({ status: 'success' });

  });

});


// Change the parameters of a project.

app.ajax.on('projectdb', function (data, end, query) {

  users.get(data, query, function (error, user) {

    if (!users.isAdmin(user)) {
      return end();
    }

    if (!data.id) {
      return end({ status: 'error', message: 'Invalid Project ID' });
    }

    machines.setProject(data);

    return end({ status: 'success' });

  });

});


// Rebuild the base image of a project.

app.ajax.on('rebuild', function (data, end, query) {

  users.get(data, query, function (error, user) {

    if (!users.isAdmin(user)) {
      return end();
    }

    machines.rebuild(data.project, function (error) {
      if (error) {
        return end({ status: 'error', message: error.toString() });
      }
      return end({ status: 'success' });
    });

    // For longer requests, make sure we reply before the browser retries.
    setTimeout(function () {
      return end({ status: 'started' });
    }, 42000);

  });

});


// Update the base image of a project.

app.ajax.on('update', function (data, end, query) {

  users.get(data, query, function (error, user) {

    if (!users.isAdmin(user)) {
      return end();
    }

    machines.update(data.project, function (error) {
      if (error) {
        return end({ status: 'error', message: error.toString() });
      }
      return end({ status: 'success' });
    });

    // For longer requests, make sure we reply before the browser retries.
    setTimeout(function () {
      return end({ status: 'started' });
    }, 42000);

  });

});


// Spawn a new machine for a project. (Fast!)

app.ajax.on('spawn', function (data, end, query) {

  users.get(data, query, function (error, user) {

    if (!user) {
      return end({ status: 'error', message: 'Not signed in' });
    }

    machines.spawn(data.project, user, function (error) {
      if (error) {
        return end({ status: 'error', message: error.toString() });
      }
      return end({ status: 'success' });
    });

  });

});


// Destroy a machine.

app.ajax.on('destroy', function (data, end, query) {

  users.get(data, query, function (error, user) {

    if (!user) {
      return end({ status: 'error', message: 'Not signed in' });
    }

    machines.destroy(data.machine, data.project, user, function (error) {
      if (error) {
        return end({ status: 'error', message: String(error) });
      }
      return end({ status: 'success' });
    });

  });

});


// Save a new user key, or update an existing one.

app.ajax.on('key', function (data, end, query) {

  users.get(data, query, function (error, user) {

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

});


// Teach the template system how to generate IDs (matching /[a-z0-9_-]*/).

camp.templateReader.parsers.id = function (text) {
  return text.replace(/[^\w-]/g, '').toLowerCase();
};
