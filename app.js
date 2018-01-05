// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const camp = require('camp');
const nodepath = require('path');
const selfapi = require('selfapi');

const api = require('./api/');
const blog = require('./lib/blog');
const boot = require('./lib/boot');
const db = require('./lib/db');
const github = require('./lib/github');
const hosts = require('./lib/hosts');
const log = require('./lib/log');
const machines = require('./lib/machines');
const proxyHeuristics = require('./lib/proxy-heuristics');
const routes = require('./lib/routes');
const users = require('./lib/users');

boot.executeInParallel([
  boot.forwardHttp,
  boot.ensureHttpsCertificates,
  boot.ensureDockerTlsCertificates
], () => {
  // You can customize these values in './db.json'.
  const hostname = db.get('hostname', 'localhost');
  const https = db.get('https');
  const ports = db.get('ports');
  const security = db.get('security');

  // The main Janitor server.
  const app = camp.start({
    documentRoot: process.cwd() + '/static',
    saveRequestChunks: true,
    port: ports.https,
    secure: !security.forceHttp,
    key: https.key,
    cert: https.crt,
    ca: https.ca
  });

  log('[ok] Janitor → http' + (security.forceHttp ? '' : 's') + '://' +
    hostname + ':' + ports.https);

  // Protect the server and its users with a security policies middleware.
  const enforceSecurityPolicies = (request, response, next) => {
    // Only accept requests addressed to our actual hostname.
    const requestedHostname = request.headers.host;
    if (requestedHostname !== hostname) {
      routes.drop(response, 'invalid hostname: ' + requestedHostname);
      return;
    }

    // Tell browsers to only use secure HTTPS connections for this web app.
    response.setHeader('Strict-Transport-Security', 'max-age=31536000');

    // Prevent browsers from accidentally seeing scripts where they shouldn't.
    response.setHeader('X-Content-Type-Options', 'nosniff');

    // Tell browsers this web app should never be embedded into an iframe.
    response.setHeader('X-Frame-Options', 'DENY');

    next();
  };

  if (!security.forceInsecure) {
    app.handle(enforceSecurityPolicies);
  } else {
    log('[warning] disabled all https security policies');
  }

  // Authenticate signed-in user requests and sessions with a server middleware.
  app.handle((request, response, next) => {
    users.get(request, (user, session) => {
      request.session = session;
      request.user = user;
      next();
    });
  });

  // Authenticate OAuth2 requests with a server middleware.
  app.handle((request, response, next) => {
    request.oauth2scope = users.getOAuth2ScopeWithUser(request);
    next();
  });

  // Mount the Janitor API.
  selfapi(app, '/api', api);

  // Public landing page.
  app.route(/^\/$/, (data, match, end, query) => {
    const { user } = query.req;
    routes.landingPage(query.res, user);
  });

  // Public API (when wrongly used with a trailing '/').
  app.route(/^\/api\/(.+)\/$/, (data, match, end, query) => {
    routes.redirect(query.res, '/api/' + match[1]);
  });

  // Public API reference.
  app.route(/^\/reference\/api\/?$/, (data, match, end, query) => {
    const { user } = query.req;
    log('api reference');
    routes.apiPage(query.res, api, user);
  });

  // Public blog page.
  app.route(/^\/blog\/?$/, (data, match, end, query) => {
    const { user } = query.req;
    log('blog');
    routes.blogPage(query.res, user);
  });

  // New public blog page.
  app.route(/^\/blog-new\/?$/, (data, match, end, query) => {
    const { req: request, res: response } = query;
    const { user } = request;
    log('blog-new');
    routes.blogPageNew(response, user, blog);
  });

  // Public live data page.
  app.route(/^\/data\/?$/, (data, match, end, query) => {
    const { user } = query.req;
    routes.dataPage(query.res, user);
  });

  // Public design page
  app.route(/^\/design\/?$/, (data, match, end, query) => {
    const { user } = query.req;
    routes.designPage(query.res, user);
  });

  // Public project pages.
  app.route(/^\/projects(\/[\w-]+)?\/?$/, (data, match, end, query) => {
    const { user } = query.req;
    const projectUri = match[1];
    if (!projectUri) {
      // No particular project was requested, show them all.
      routes.projectsPage(query.res, user);
      return;
    }

    const projectId = projectUri.slice(1);
    const project = db.get('projects')[projectId];
    if (!project) {
      // The requested project doesn't exist.
      routes.notFoundPage(query.res, user);
      return;
    }

    routes.projectPage(query.res, project, user);
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

  // User login page.
  app.route(/^\/login\/?$/, (data, match, end, query) => {
    const { user } = query.req;
    if (!user) {
      routes.loginPage(query.res);
      return;
    }

    routes.redirect(query.res, '/');
  });

  // User login via GitHub.
  app.route(/^\/login\/github\/?$/, async (data, match, end, query) => {
    const { req: request, res: response } = query;
    const { user } = request;
    if (!user) {
      // Don't allow signing in only with GitHub just yet.
      routes.notFoundPage(response, user);
      return;
    }

    let accessToken = null;
    let refreshToken = null;
    try {
      ({ accessToken, refreshToken } = await github.authenticate(request));
    } catch (error) {
      log('[fail] github authentication', error);
      routes.notFoundPage(response, user);
      return;
    }

    try {
      await users.refreshGitHubAccount(user, accessToken, refreshToken);
    } catch (error) {
      log('[fail] could not refresh github account', error);
    }

    routes.redirect(response, '/settings/integrations/');
  });

  // User OAuth2 authorization.
  app.route(/^\/login\/oauth\/authorize\/?$/, (data, match, end, query) => {
    const { req: request, res: response } = query;
    const { user } = request;
    if (!user) {
      routes.notFoundPage(response, user);
      return;
    }

    hosts.issueOAuth2AuthorizationCode(request).then(data => {
      routes.redirect(response, data.redirect_url);
    }).catch(error => {
      log('[fail] oauth2 authorize', error);
      // Note: Such OAuth2 sanity problems should rarely happen, but if they
      // do become more frequent, we should inform the user about what's
      // happening here instead of showing a generic 404 page.
      routes.notFoundPage(response, user);
    });
  });

  // OAuth2 access token request.
  app.route(/^\/login\/oauth\/access_token\/?$/, (data, match, end, query) => {
    const { req: request, res: response } = query;
    if (request.method !== 'POST') {
      routes.notFoundPage(response, request.user);
      return;
    }

    const authenticatedHostname = hosts.authenticate(request);
    if (!authenticatedHostname) {
      response.statusCode = 403; // Forbidden
      response.json({ error: 'Unauthorized' });
      return;
    }

    hosts.issueOAuth2AccessToken(request).then(data => {
      response.json(data, null, 2);
    }).catch(error => {
      log('[fail] oauth2 token', error);
      response.statusCode = 400; // Bad Request
      response.json({ error: 'Could not issue OAuth2 access token' }, null, 2);
    });
  });

  // User contributions list. (legacy - redirect to containers page)
  app.route(/^\/contributions\/?$/, (data, match, end, query) => {
    routes.redirect(query.res, '/containers/', true);
  });

  // User containers list.
  app.route(/^\/containers\/?$/, (data, match, end, query) => {
    const { req: request, res: response } = query;
    const { user } = request;
    if (!user) {
      routes.loginPage(response);
      return;
    }

    routes.containersPage(response, user);
  });

  // User new containers list.
  app.route(/^\/containers-new\/?$/, (data, match, end, query) => {
    const { req: request, res: response } = query;
    const { user } = request;
    if (!user) {
      routes.loginPage(response);
      return;
    }

    routes.containersPageNew(response, user);
  });

  // User notifications.
  app.route(/^\/notifications\/?$/, (data, match, end, query) => {
    const { user } = query.req;
    if (!user) {
      routes.loginPage(query.res);
      return;
    }

    routes.notificationsPage(query.res, user);
  });

  // User settings.
  app.route(/^\/settings(\/\w+)?\/?$/, (data, match, end, query) => {
    const { req: request, res: response } = query;
    const { user } = request;
    if (!user) {
      routes.loginPage(response);
      return;
    }

    // Select the requested section, or serve the default one.
    const sectionUri = match[1];
    const section = sectionUri ? sectionUri.slice(1) : 'account';

    routes.settingsPage(request, response, section, user);
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
    const { user } = query.req;
    if (!users.isAdmin(user)) {
      routes.notFoundPage(query.res, user);
      return;
    }

    // Select the requested section, or serve the default one.
    const sectionUri = match[1];
    const section = sectionUri ? sectionUri.slice(1) : 'docker';

    log('admin', section, '(' + user._primaryEmail + ')');

    routes.adminPage(query.res, section, user);
  });

  // FIXME: The main Janitor server should only operate a cluster of dedicated
  // Docker servers, but not host containers itself directly. We should remove
  // the containers from the main server, and delete the proxy handlers below.

  // FIXME: Remove this deprecated handler (see comments above).
  // Proxy requests to local containers using URLs like '/:container/:port/*'.
  // Example:
  //   'https://<hostname>/abc123/8080/index.html' should proxy to
  //   'http://localhost:8080/index.html' in Docker container 'abc123'.
  app.route(proxyHeuristics.proxyUrlPrefix, (data, match, end, query) => {
    proxyRequest(query.req, query.res);
  });

  // FIXME: Remove this deprecated handler (see comments above).
  // Proxy Cloud9 IDE requests to local containers.
  // Examples:
  //   '/_ping'
  //   '/static/lib/tern/defs/ecma5.json'
  //   '/static/standalone/worker/plugins/c9.ide.language.core/worker.js'
  //   '/vfs/1?access_token=token'
  //   '/vfs/1/9ceokVZPKGlhYWec/workspace/_/_/tab1'
  app.route(/^\/(_ping|static\/.+|vfs\/.+)$/, (data, match, end, query) => {
    proxyRequest(query.req, query.res);
  });

  // FIXME: Remove this deprecated handler (see comments above).
  const proxyRequest = (request, response) => {
    const { user } = request;
    if (!user) {
      routes.notFoundPage(response, user);
      return;
    }

    proxyHeuristics.handleProxyUrls(request, response, () => {
      let { container, port } = request.query;
      if (!container || !port) {
        // FIXME: Containers and ports should always be explicitly requested.
        const likelyProxyRequest = proxyHeuristics.guessProxyRequest(request);
        if (!likelyProxyRequest) {
          routes.notFoundPage(response, user);
          return;
        }
        container = request.query.container = likelyProxyRequest.container;
        port = request.query.port = likelyProxyRequest.port;
      }

      const machine = machines.getMachineByContainer(user, hostname, container);
      if (!machine) {
        routes.notFoundPage(response, user);
        return;
      }

      const mappedPort = machine.docker.ports[port];
      if (!mappedPort || mappedPort.proxy !== 'https') {
        routes.notFoundPage(response, user);
        return;
      }

      // Remember this request for the WebSocket proxy (see below).
      proxyHeuristics.rememberProxyRequest(request);

      routes.webProxy(request, response, {
        port: mappedPort.port,
        path: nodepath.normalize(request.url)
      });
    });
  };

  // FIXME: Remove this deprecated handler (see comments above).
  // Proxy WebSocket connections to local containers.
  app.on('upgrade', (request, socket, head) => {
    // Authenticate the user (our middleware only works for 'request' events).
    users.get(request, (user, session) => {
      if (!user || !session) {
        socket.end();
        return;
      }

      // Note: Some proxy heuristics need a `request.session`. Add it here.
      request.session = session;
      request.user = user;

      // FIXME: Containers and ports should always be explicitly requested.
      const likelyProxyRequest = proxyHeuristics.guessProxyRequest(request);
      if (!likelyProxyRequest) {
        socket.end();
        return;
      }

      const { container, port } = likelyProxyRequest;
      const machine = machines.getMachineByContainer(user, hostname, container);
      if (!machine) {
        socket.end();
        return;
      }

      const mappedPort = machine.docker.ports[port];
      if (!mappedPort || mappedPort.proxy !== 'https') {
        socket.end();
        return;
      }

      routes.webProxy(request, socket, {
        port: mappedPort.port,
        path: nodepath.normalize(request.url)
      });
    });
  });

  // 404 Not Found.
  app.notfound(/.*/, (data, match, end, query) => {
    const { user } = query.req;
    log('404', match[0]);
    routes.notFoundPage(query.res, user);
  });

  // Alpha version sign-up.
  app.ajax.on('signup', (data, end) => {
    const email = data.email;
    const users = db.get('users');
    const waitlist = db.get('waitlist');

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
    const { user } = query.req;
    if (!users.isAdmin(user)) {
      end();
      return;
    }

    const email = data.email;
    if (email in db.get('users')) {
      end({ status: 'already-invited' });
      return;
    }

    users.sendInviteEmail(email, error => {
      if (error) {
        const message = String(error);
        log(message, '(while inviting ' + email + ')');
        end({ status: 'error', message: message });
        return;
      }
      end({ status: 'invited' });
    });
  });

  // Request a log-in key via email.
  app.ajax.on('login', (data, end, query) => {
    const { user } = query.req;
    if (user) {
      end({ status: 'logged-in' });
      return;
    }

    const email = data.email;
    users.sendLoginEmail(email, query.req, error => {
      if (error) {
        const message = String(error);
        log(message, '(while emailing ' + email + ')');
        end({ status: 'error', message: message });
        return;
      }
      end({ status: 'email-sent' });
    });
  });

  // Change the parameters of a project.
  app.ajax.on('projectdb', (data, end, query) => {
    const { user } = query.req;
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

  // Update the base image of a project.
  app.ajax.on('update', (data, end, query) => {
    const { user } = query.req;
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

  // Save a new user key, or update an existing one.
  app.ajax.on('key', (data, end, query) => {
    const { user } = query.req;
    if (!user || !data.name || !data.key) {
      end();
      return;
    }

    let key = '';
    let match;
    switch (data.name) {
      case 'cloud9':
        // Extract a valid SSH public key from the user's input.
        // Regex adapted from https://gist.github.com/paranoiq/1932126.
        match = data.key.match(/ssh-rsa [\w+/]+[=]{0,3}/);
        if (!match) {
          return end({ status: 'error', message: 'Invalid SSH key' });
        }
        key = match[0];
        log('key', data.name, user._primaryEmail);
        break;

      case 'cloud9user':
        // Cloud9 usernames consist of lowercase letters, numbers and '_' only.
        match = data.key.trim().match(/^[a-z0-9_]+$/);
        if (!match) {
          return end({ status: 'error', message: 'Invalid Cloud9 username' });
        }
        key = match[0];
        log('key', data.name, user._primaryEmail, key);
        break;

      default:
        end({ status: 'error', message: 'Unknown key name' });
    }

    user.keys[data.name] = key;
    db.save();

    end({ status: 'key-saved' });
  });
});
