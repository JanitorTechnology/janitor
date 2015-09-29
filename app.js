var camp = require('camp');
var http = require('http');

var db = require('./lib/db');
var log = require('./lib/log');
var machines = require('./lib/machines');
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

  var title = '';

  users.get(data, query, function (err, user) {
    machines.getProjects(function (err, projects) {
      end({
        projects: projects,
        title: title,
        user: user
      }, { template: [
        '../templates/header.html',
        '../templates/landing.html',
        '../templates/projects.html',
        '../templates/footer.html'
      ]});
    });
  });

});


// User contributions list.

app.route(/^\/contributions\/(.*)$/, function (data, match, end, query) {

  var title = 'My Contributions';
  var path = match[1];

  users.get(data, query, function (err, user) {
    end({
      title: title,
      user: user
    }, { template: [
      '../templates/header.html',
      '../templates/contributions.html',
      '../templates/footer.html'
    ]});
  });

});


// User account.

app.route(/\/account\/$/, function (data, match, end, query) {

  var title = 'My Account';

  users.get(data, query, function (err, user) {
    end({
      title: title,
      user: user
    }, { template: [
      '../templates/header.html',
      '../templates/account.html',
      '../templates/footer.html'
    ]});
  });

});


// User login.

app.route(/\/login$/, function (data, match, end, query) {

  var title = 'Sign In';

  users.get(data, query, function (err, user) {
    end({
      title: title,
      user: user,
    }, { template: [
      '../templates/header.html',
      '../templates/login.html',
      '../templates/footer.html'
    ]});
  });

});


// User logout.

app.route(/\/logout$/, function (data, match, end, query) {

  users.logout(query, function (err) {
    query.res.statusCode = 302;
    query.res.setHeader('Location', '/');
    query.res.end();
  });

});


// 404 Not Found.

app.notfound(/.*/, function (data, match, end, query) {

  var title = 'Page not found!';

  log('404', match[0]);

  users.get(data, query, function (err, user) {
    end({
      title: title,
      user: user
    }, { template: [
      '../templates/header.html',
      '../templates/404.html',
      '../templates/footer.html'
    ]});
  });

});


// Alpha version sign-up.

app.ajax.on('signup', function (data, end) {

  var email = data.email;
  var waitlist = db.get('waitlist');

  log('signup', email);

  if (waitlist[email]) {
    end({ status: 'already-added' });
    return;
  }

  waitlist[email] = Date.now();
  db.save();

  end({ status: 'added' });

});


// Request a log-in key via email.

app.ajax.on('login', function (data, end, query) {

  var email = data.email;

  users.get(data, query, function (err, user) {
    if (user) {
      end({ status: 'logged-in' });
      return;
    }
    users.sendLoginEmail(email, query, function (err) {
      if (err) {
        var error = err.toString();
        log(error, 'while emailing', email);
        end({ status: 'error', message: error });
        return;
      }
      end({ status: 'email-sent' });
    });
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
