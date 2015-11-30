// Copyright © 2015 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

var camp = require('camp');
var http = require('http');

var db = require('./lib/db');
var log = require('./lib/log');
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

  users.get(data, query, function (err, user) {
    return routes.landingPage(user, end);
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

  users.get(data, query, function (err, user) {

    if (user) {
      return routes.redirect(query, '/');
    }

    return routes.loginPage(end);

  });

});


// User contributions list.

app.route(/^\/contributions\/?$/, function (data, match, end, query) {

  users.get(data, query, function (err, user) {

    if (user) {
      return routes.contributionsPage(user, end);
    }

    return routes.loginPage(end);

  });

});


// User account.

app.route(/^\/account\/?$/, function (data, match, end, query) {

  users.get(data, query, function (err, user) {

    if (user) {
      return routes.accountPage(user, end);
    }

    return routes.loginPage(end);

  });

});


// 404 Not Found.

app.notfound(/.*/, function (data, match, end, query) {

  log('404', match[0]);

  users.get(data, query, function (err, user) {
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

  users.get(data, query, function (err, user) {

    if (!users.isAdmin(user)) {
      return end();
    }

    var email = data.email;

    if (email in db.get('users')) {
      return end({ status: 'already-invited' });
    }

    users.sendInviteEmail(email, query, function (err) {
      if (err) {
        var error = err.toString();
        log(error, '(while inviting ' + email + ')');
        return end({ status: 'error', message: error });
      }
      return end({ status: 'invited' });
    });

  });

});


// Request a log-in key via email.

app.ajax.on('login', function (data, end, query) {

  users.get(data, query, function (err, user) {

    if (user) {
      end({ status: 'logged-in' });
      return;
    }

    var email = data.email;

    users.sendLoginEmail(email, query, function (err) {
      if (err) {
        var error = err.toString();
        log(error, '(while emailing ' + email + ')');
        return end({ status: 'error', message: error });
      }
      return end({ status: 'email-sent' });
    });

  });

});


// Save a new user key, or update an existing one.

app.ajax.on('key', function (data, end, query) {

  users.get(data, query, function (err, user) {

    if (!user || !data.name) {
      return end();
    }

    log('key', data.name, user.email);

    user.keys[data.name] = data.key;
    db.save();

    return end({ status: 'key-saved' });

  });

});


// Expose Shipyard over HTTPS on port 1789.

shipyard.start({
  port: 1789,
  key: 'https.key',
  cert: 'https.crt',
  ca: []
});

log('Shipyard →  https://localhost:' + 1789);
