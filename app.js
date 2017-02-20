// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

let camp = require('@jankeromnes/camp');
let nodepath = require('path');
let selfapi = require('selfapi');

let api = require('./api/');
let boot = require('./lib/boot');
let db = require('./lib/db');
let hosts = require('./lib/hosts');
let log = require('./lib/log');
let machines = require('./lib/machines');
let routes = require('./lib/routes');
let users = require('./lib/users');

boot.executeInParallel([
  boot.forwardHttp,
  boot.ensureHttpsCertificates,
  boot.ensureDockerTlsCertificates
], () => {

  // You can customize these values in './db.json'.
  let hostname = db.get('hostname', 'localhost');
  let https = db.get('https');
  let ports = db.get('ports');

  // The main Janitor server.
  let app = camp.start({
    documentRoot: process.cwd() + '/static',
    port: ports.https,
    secure: true,
    key: https.key,
    cert: https.crt,
    ca: https.ca
  });

  log('Janitor → https://' + hostname + ':' + ports.https);

  // Convenient express-like alias.
  app.use = app.handle;

  // Protect the server and its users with a security policies middleware.
  app.use((request, response, next) => {
    // Only accept requests addressed to our hostname, no CDN here.
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

  // Authenticate signed-in user requests with a server middleware.
  app.use((request, response, next) => {
    users.get(request, user => {
      request.user = user;
      next();
    });
  });

  // Authenticate OAuth2 requests with a server middleware.
  app.use((request, response, next) => {
    request.oauth2scope = users.getOAuth2ScopeWithUser(request);
    next();
  });

  // Mount the Janitor API.
  selfapi(app, '/api', api);

  // Public landing page.
  app.route(/^\/$/, (data, match, end, query) => {
    let user = query.req.user;

    return routes.landingPage(user, end);
  });

  // Public blog page.
  app.route(/^\/blog\/?$/, (data, match, end, query) => {
    let { user } = query.req;
    log('blog');
    routes.blogPage(user, end);
  });

  // Public live data page.
  app.route(/^\/data\/?$/, (data, match, end, query) => {
    let { user } = query.req;
    routes.dataPage(user, end);
  });

  // Public project pages.
  app.route(/^\/projects(\/\w+)?\/?$/, (data, match, end, query) => {
    var user = query.req.user;
    var projectUri = match[1];

    if (!projectUri) {
      // No particular project was requested, show them all.
      routes.projectsPage(user, end);
      return;
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
    users.logout(query.req, error => {
      if (error) {
        log('[fail] logout', error);
      }
      routes.redirect(query.res, '/');
    });
  });

  // User login.
  app.route(/^\/login\/?$/, (data, match, end, query) => {
    let { user } = query.req;
    if (user) {
      routes.redirect(query.res, '/');
      return;
    }
    routes.loginPage(end);
  });

  // User OAuth2 authorization.
  app.route(/^\/login\/oauth\/authorize\/?$/, (data, match, end, query) => {
    let { user } = query.req;
    if (!user) {
      routes.notFoundPage(user, end, query);
      return;
    }

    hosts.issueOAuth2AuthorizationCode(query.req, (error, data) => {
      if (error) {
        log('[fail] oauth2 authorize', error);
        // Note: Such OAuth2 sanity problems should rarely happen, but if they
        // do become more frequent, we should inform the user about what's
        // happening here instead of showing a generic 404 page.
        routes.notFoundPage(user, end, query);
        return;
      }
      routes.redirect(query.res, data.redirect_url);
    });
  });

  // OAuth2 access token request.
  app.route(/^\/login\/oauth\/access_token\/?$/, (data, match, end, query) => {
    let { req: request, res: response } = query;
    if (request.method !== 'POST') {
      routes.notFoundPage(request.user, end, query);
      return;
    }

    let authenticatedHostname = hosts.authenticate(request);
    if (!authenticatedHostname) {
      response.statusCode = 403; // Forbidden
      response.json({ error: 'Unauthorized' });
      return;
    }

    hosts.issueOAuth2AccessToken(request, (error, data) => {
      if (error) {
        log('[fail] oauth2 token', error);
        response.statusCode = 400; // Bad Request
      }
      response.json(data);
    });
  });

  // User contributions list.
  app.route(/^\/contributions\/?$/, (data, match, end, query) => {
    let { user } = query.req;
    if (!user) {
      routes.loginPage(end);
      return;
    }

    routes.contributionsPage(user, end);
  });

  // User settings.
  app.route(/^\/settings(\/\w+)?\/?$/, (data, match, end, query) => {
    let { user } = query.req;
    if (!user) {
      routes.loginPage(end);
      return;
    }

    // Select the requested section, or serve the default one.
    let sectionUri = match[1];
    let section = sectionUri ? sectionUri.slice(1) : 'account';

    routes.settingsPage(section, user, end, query);
  });

  // User account (now part of settings).
  app.route(/^\/account\/?$/, (data, match, end, query) => {
    routes.redirect(query.res, '/settings/account/', true);
  });

  // These are not the droids you're looking for.
  app.route(/^\/favicon\.ico$/, (data, match, end, query) => {
    routes.redirect(query.res, '/img/janitor.svg', true);
  });

  app.route(/^\/apple-touch-icon[\w-]*\.png$/, (data, match, end, query) => {
    routes.redirect(query.res, '/img/janitor.svg', true);
  });

  app.route(/^\/[.,;)]$/, (data, match, end, query) => {
    routes.redirect(query.res, '/', true);
  });

  // Admin sections.
  app.route(/^\/admin(\/\w+)?\/?$/, (data, match, end, query) => {
    let { user } = query.req;
    if (!users.isAdmin(user)) {
      routes.notFoundPage(user, end, query);
      return;
    }

    // Select the requested section, or serve the default one.
    let sectionUri = match[1];
    let section = sectionUri ? sectionUri.slice(1) : 'hosts';

    log('admin', section, '(' + user.email + ')');

    routes.adminPage(section, user, end, query);
  });

  // FIXME: The main Janitor server should only operate a cluster of dedicated
  // Docker servers, but not host containers itself directly. We should remove
  // the containers from the main server, and delete the proxy handlers below.

  // FIXME: Remove this deprecated handler (see comments above).
  // Proxy requests to local containers using URLs like '/:container/:port/*'.
  // Example:
  //   'https://<hostname>/abc123/8080/index.html' should proxy to
  //   'http://localhost:8080/index.html' in Docker container 'abc123'.
  app.route(/^\/([0-9a-f]{16,})\/(\d+)(\/.*)$/, (data, match, end, query) => {
    // Note: In this regex, we expect a 16+ hex-digit container ID, a numeric
    // port, and a path that starts with a '/'. These anonymous patterns are
    // captured in the `match` array.
    const { user } = query.req;
    if (!user) {
      routes.notFoundPage(user, end, query);
      return;
    }

    const container = match[1];
    const port = String(match[2]);
    const path = nodepath.normalize(match[3]);

    const machine = machines.getMachineByContainer(user, hostname, container);
    if (!machine) {
      routes.notFoundPage(user, end, query);
      return;
    }

    const mappedPort = machine.docker.ports[port];
    if (!mappedPort || mappedPort.proxy !== 'https') {
      routes.notFoundPage(user, end, query);
      return;
    }

    // Remember this port for the WebSocket proxy (see below).
    user.lastProxyPort = mappedPort.port;
    routes.webProxy({ port: mappedPort.port, path }, query.req, query.res);
  });

  // FIXME: Remove this deprecated handler (see comments above).
  // Proxy WebSocket connections to local containers.
  app.on('upgrade', (request, socket, head) => {
    // Authenticate the user (our middleware only works for 'request' events).
    users.get(request, user => {
      if (!user || !user.lastProxyPort) {
        socket.end();
        return;
      }

      const port = user.lastProxyPort;
      const path = nodepath.normalize(request.url);
      routes.webProxy({ port, path }, request, socket);
    });
  });

  // 404 Not Found.
  app.notfound(/.*/, (data, match, end, query) => {
    let { user } = query.req;

    log('404', match[0]);

    routes.notFoundPage(user, end, query);
  });

  // Alpha version sign-up.
  app.ajax.on('signup', (data, end) => {
    let email = data.email;
    let users = db.get('users');
    let waitlist = db.get('waitlist');

    log('signup', email);

    if (waitlist[email]) {
      end({ status: 'already-added' });
      return;
    }

    if (users[email]) {
      end({ status: 'already-invited' });
      return;
    }

    waitlist[email] = Date.now();
    db.save();

    end({ status: 'added' });
  });

  // Alpha version invite.
  app.ajax.on('invite', (data, end, query) => {
    let { user } = query.req;
    if (!users.isAdmin(user)) {
      end();
      return;
    }

    let email = data.email;
    if (email in db.get('users')) {
      end({ status: 'already-invited' });
      return;
    }

    users.sendInviteEmail(email, error => {
      if (error) {
        let message = String(error);
        log(message, '(while inviting ' + email + ')');
        end({ status: 'error', message: message });
        return;
      }
      end({ status: 'invited' });
    });
  });

  // Request a log-in key via email.
  app.ajax.on('login', (data, end, query) => {
    let { user } = query.req;
    if (user) {
      end({ status: 'logged-in' });
      return;
    }

    let email = data.email;
    users.sendLoginEmail(email, query.req, error => {
      if (error) {
        let message = String(error);
        log(message, '(while emailing ' + email + ')');
        end({ status: 'error', message: message });
        return;
      }
      end({ status: 'email-sent' });
    });
  });

  // Change the parameters of a project.
  app.ajax.on('projectdb', (data, end, query) => {
    let { user } = query.req;
    if (!users.isAdmin(user)) {
      end();
      return;
    }

    if (!data.id) {
      end({ status: 'error', message: 'Invalid project ID' });
      return;
    }

    machines.setProject(data);
    end({ status: 'success' });
  });

  // Rebuild the base image of a project.
  app.ajax.on('rebuild', (data, end, query) => {
    let { user } = query.req;
    if (!users.isAdmin(user)) {
      end();
      return;
    }

    machines.rebuild(data.project, error => {
      if (error) {
        end({ status: 'error', message: String(error) });
        return;
      }
      end({ status: 'success' });
    });

    // For longer requests, make sure we reply before the browser retries.
    setTimeout(() => {
      end({ status: 'started' });
    }, 42000);
  });

  // Update the base image of a project.
  app.ajax.on('update', (data, end, query) => {
    let { user } = query.req;
    if (!users.isAdmin(user)) {
      end();
      return;
    }

    machines.update(data.project, error => {
      if (error) {
        end({ status: 'error', message: String(error) });
        return;
      }
      end({ status: 'success' });
    });

    // For longer requests, make sure we reply before the browser retries.
    setTimeout(() => {
      end({ status: 'started' });
    }, 42000);
  });

  // Spawn a new machine for a project. (Fast!)
  app.ajax.on('spawn', (data, end, query) => {
    let { user } = query.req;
    if (!user) {
      end({ status: 'error', message: 'Not signed in' });
      return;
    }

    machines.spawn(user, data.project, error => {
      if (error) {
        end({ status: 'error', message: String(error) });
        return;
      }
      end({ status: 'success' });
    });
  });

  // Destroy a machine.
  app.ajax.on('destroy', (data, end, query) => {
    let { user } = query.req;
    if (!user) {
      end({ status: 'error', message: 'Not signed in' });
      return;
    }

    machines.destroy(user, data.project, data.machine, error => {
      if (error) {
        end({ status: 'error', message: String(error) });
        return;
      }
      end({ status: 'success' });
    });
  });

  // Save a new user key, or update an existing one.
  app.ajax.on('key', (data, end, query) => {
    let { user } = query.req;
    if (!user || !data.name || !data.key) {
      end();
      return;
    }

    let key = '';
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
        end({ status: 'error', message: 'Unknown key name' });
    }

    user.keys[data.name] = key;
    db.save();

    end({ status: 'key-saved' });
  });
});

// Teach the template system how to generate IDs (matching /[a-z0-9_-]*/).
camp.templateReader.parsers.id = text => {
  return text.replace(/[^\w-]/g, '').toLowerCase();
};
