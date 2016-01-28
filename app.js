// Copyright © 2015 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

var camp = require('camp');
var http = require('http');
var path = require('path');

var db = require('./lib/db');
var log = require('./lib/log');
var machines = require('./lib/machines');
var routes = require('./lib/routes');
var shipyard = require('./lib/shipyard');
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


// Projects page.

app.route(/^\/projects\/?$/, function (data, match, end, query) {

  users.get(data, query, function (error, user) {

    return routes.projectsPage(user, end);

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


// Admin section.

app.route(/^\/admin\/?$/, function (data, match, end, query) {

  users.get(data, query, function (error, user) {

    if (users.isAdmin(user)) {
      return routes.adminPage(user, end);
    }

    return routes.notFoundPage(user, end);

  });

});


// Secure VNC connection proxy.

app.route(/^\/vnc\/(\w+)\/(\d+)(\/.*)$/, function (data, match, end, query) {

  users.get(data, query, function (error, user) {

    if (!user) {
      return routes.notFoundPage(user, end);
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
      return routes.vncProxy(user, end, machine, query, uri);
    }

    return routes.notFoundPage(user, end);

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
    return routes.notFoundPage(user, end);
  });

});


// Alpha version sign-up.

app.ajax.on('signup', function (data, end) {

  var email = data.email;
  var waitlist = db.get('waitlist');

  log('signup', email);

  if (waitlist[email]) {
    return end({ status: 'already-added' });
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

    machines.rebuild(data.id, function (error, logs) {
      if (error) {
        return end({ status: 'error', message: error.toString(), logs: logs });
      }
      return end({ status: 'success', logs: logs });
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

    machines.update(data.id, function (error, logs) {
      if (error) {
        return end({ status: 'error', message: error.toString(), logs: logs });
      }
      return end({ status: 'success', logs: logs });
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

    machines.spawn(data.id, user, function (error, logs) {
      if (error) {
        return end({ status: 'error', message: error.toString(), logs: logs });
      }
      return end({ status: 'success', logs: logs });
    });

  });

});


// Save a new user key, or update an existing one.

app.ajax.on('key', function (data, end, query) {

  users.get(data, query, function (error, user) {

    if (!user || !data.name || !data.key) {
      return end();
    }

    // Extract a valid SSH public key from the user's input.
    // Regex adapted from https://gist.github.com/paranoiq/1932126.
    var match = data.key.match(/ssh-rsa [\w+\/]+[=]{0,3}/);
    if (!match) {
      return end({ status: 'error', message: 'Invalid SSH key' });
    }

    var key = match[0];

    log('key', data.name, user.email);
    user.keys[data.name] = key;
    db.save();

    return end({ status: 'key-saved' });

  });

});


// Teach the template system how to generate IDs (matching /[a-z0-9_-]*/).

camp.templateReader.parsers.id = function (text) {
  return text.replace(/[^\w-]/g, '').toLowerCase();
};
