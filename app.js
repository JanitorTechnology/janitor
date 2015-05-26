var camp = require('camp');
var http = require('http');

var db = require('./lib/db');
var log = require('./lib/log');
var machines = require('./lib/machines');
var shipyard = require('./lib/shipyard');

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

app.route(/^\/$/, function (data, match, end) {

  var title = '';

  machines.getProjects(function (err, projects) {
    end({
      title: title,
      contributions: [7,8,9],
      projects: projects
    }, { template: [
      '../templates/header.html',
      '../templates/landing.html',
      '../templates/projects.html',
      '../templates/footer.html'
    ]});
  });

});


// User contributions list.

app.route(/^\/contributions\/(.*)$/, function (data, match, end) {

  var title = 'My Contributions';
  var contributions = [7,8,9];
  var path = match[1];

  end({
    title: title,
    contributions: contributions
  }, { template: [
    '../templates/header.html',
    '../templates/contributions.html',
    '../templates/footer.html'
  ]});

});


// User account.

app.route(/\/account\/$/, function (data, match, end) {

  var title = 'My Account';

  end({
    title: title,
    contributions: [7,8,9]
  }, { template: [
    '../templates/header.html',
    '../templates/account.html',
    '../templates/footer.html'
  ]});

});


// User login.

app.route(/\/login$/, function (data, match, end) {

  var title = 'Sign In';

  // TODO for user:
  // - git config --global user.{name,email}
  // - Create SSH key to use on GitHub
  // - Authorize Cloud9 SSH key
  // - Authorize optional user SSH key

  end({
    title: title,
    contributions: [7,8,9]
  }, { template: [
    '../templates/header.html',
    '../templates/login.html',
    '../templates/footer.html'
  ]});

});


// User logout.

app.route(/\/logout$/, function (data, match, end, query) {

  query.res.statusCode = 302;
  query.res.setHeader('Location', '/');
  query.res.end();

});


// Remote service authentication.

app.route(/\auth$/, function (data, match, end) {

  end();

});


// 404 Not Found.

app.notfound(/.*/, function (data, match, end) {

  var title = 'Page not found!';

  log('404', match[0]);

  end({
    title: title,
    contributions: [7,8,9]
  }, { template: [
    '../templates/header.html',
    '../templates/404.html',
    '../templates/footer.html'
  ]});

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


// Expose Shipyard over HTTPS on port 1789.

shipyard.start({
  port: 1789,
  key: 'https.key',
  cert: 'https.crt',
  ca: []
});

log('Shipyard →  https://localhost:' + 1789);
