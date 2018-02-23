// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const camp = require('camp');
const selfapi = require('selfapi');

const api = require('./api/');
const blog = require('./lib/blog');
const boot = require('./lib/boot');
const db = require('./lib/db');
const github = require('./lib/github');
const hosts = require('./lib/hosts');
const log = require('./lib/log');
const machines = require('./lib/machines');
const routes = require('./lib/routes');
const users = require('./lib/users');

boot.executeInParallel([
  boot.forwardHttp,
  boot.ensureHttpsCertificates,
  boot.ensureDockerTlsCertificates
], () => {
  // You can customize these values in './db.json'.
  const hostnames = db.get('hostnames', [ 'localhost' ]);
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
    hostnames[0] + ':' + ports.https);

  // Protect the server and its users with a security policies middleware.
  const enforceSecurityPolicies = (request, response, next) => {
    // Only accept requests addressed to our actual hostnames.
    const requestedHostname = request.headers.host;
    if (!requestedHostname || hostnames.indexOf(requestedHostname) < 0) {
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

  // Compute canonical resource URLs with a server middleware.
  app.handle((request, response, next) => {
    request.canonicalUrl = 'https://' + hostnames[0] + request.url;
    next();
  });

  // Mount the Janitor API.
  selfapi(app, '/api', api);

  // Public landing page.
  app.route(/^\/$/, (data, match, end, query) => {
    routes.landingPage(query.req, query.res);
  });

  // Public API (when wrongly used with a trailing '/').
  app.route(/^\/api\/(.+)\/$/, (data, match, end, query) => {
    routes.redirect(query.res, '/api/' + match[1]);
  });

  // Public API reference.
  app.route(/^\/reference\/api\/?$/, (data, match, end, query) => {
    log('api reference');
    routes.apiPage(query.req, query.res, api);
  });

  // New Public API reference.
  app.route(/^\/reference\/api-new\/?$/, (data, match, end, query) => {
    log('api reference');
    routes.apiPageNew(query.req, query.res, api);
  });

  // Public blog page.
  app.route(/^\/blog\/?$/, (data, match, end, query) => {
    log('blog');
    routes.blogPage(query.req, query.res);
  });

  // New public blog page.
  app.route(/^\/blog-new\/?$/, (data, match, end, query) => {
    log('blog-new');
    routes.blogPageNew(query.req, query.res, blog);
  });

  // Public live data page.
  app.route(/^\/data\/?$/, (data, match, end, query) => {
    routes.dataPage(query.req, query.res);
  });

  // Public live data page.
  app.route(/^\/data-new\/?$/, (data, match, end, query) => {
    routes.dataPageNew(query.req, query.res);
  });

  // Public design page
  app.route(/^\/design\/?$/, (data, match, end, query) => {
    routes.designPage(query.req, query.res);
  });

  // new login page
  app.route(/^\/login-new\/?$/, (data, match, end, query) => {
    routes.newLoginPage(query.req, query.res);
  });

  // Public project pages.
  app.route(/^\/projects(\/[\w-]+)?\/?$/, (data, match, end, query) => {
    const { req: request, res: response } = query;
    const projectUri = match[1];
    if (!projectUri) {
      // No particular project was requested, show them all.
      routes.projectsPage(request, response);
      return;
    }

    const projectId = projectUri.slice(1);
    const project = db.get('projects')[projectId];
    if (!project) {
      // The requested project doesn't exist.
      routes.notFoundPage(request, response);
      return;
    }

    routes.projectPage(request, response, project);
  });

  // New public project pages.
  app.route(/^\/projects-new(\/[\w-]+)?\/?$/, (data, match, end, query) => {
    const { req: request, res: response } = query;
    const projectUri = match[1];
    if (!projectUri) {
      // No particular project was requested, show them all.
      routes.projectsPageNew(request, response);
      return;
    }

    const projectId = projectUri.slice(1);
    const project = db.get('projects')[projectId];
    if (!project) {
      // The requested project doesn't exist.
      routes.notFoundPageNew(request, response);
      return;
    }

    routes.projectPageNew(request, response, project);
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
    const { req: request, res: response } = query;
    const { user } = request;
    if (!user) {
      routes.loginPage(request, response);
      return;
    }

    routes.redirect(response, '/');
  });

  // User login via GitHub.
  app.route(/^\/login\/github\/?$/, async (data, match, end, query) => {
    const { req: request, res: response } = query;
    const { user } = request;
    if (!user) {
      // Don't allow signing in only with GitHub just yet.
      routes.notFoundPage(request, response);
      return;
    }

    let accessToken = null;
    let refreshToken = null;
    try {
      ({ accessToken, refreshToken } = await github.authenticate(request));
    } catch (error) {
      log('[fail] github authentication', error);
      routes.notFoundPage(request, response);
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
      routes.notFoundPage(request, response);
      return;
    }

    hosts.issueOAuth2AuthorizationCode(request).then(data => {
      routes.redirect(response, data.redirect_url);
    }).catch(error => {
      log('[fail] oauth2 authorize', error);
      // Note: Such OAuth2 sanity problems should rarely happen, but if they
      // do become more frequent, we should inform the user about what's
      // happening here instead of showing a generic 404 page.
      routes.notFoundPage(request, response);
    });
  });

  // OAuth2 access token request.
  app.route(/^\/login\/oauth\/access_token\/?$/, (data, match, end, query) => {
    const { req: request, res: response } = query;
    if (request.method !== 'POST') {
      routes.notFoundPage(request, response);
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
      routes.loginPage(request, response);
      return;
    }

    routes.containersPage(request, response);
  });

  // User new containers list.
  app.route(/^\/containers-new\/?$/, (data, match, end, query) => {
    const { req: request, res: response } = query;
    const { user } = request;
    if (!user) {
      routes.loginPage(request, response);
      return;
    }

    routes.containersPageNew(request, response);
  });

  // User notifications.
  app.route(/^\/notifications\/?$/, (data, match, end, query) => {
    const { req: request, res: response } = query;
    const { user } = request;
    if (!user) {
      routes.loginPage(request, response);
      return;
    }

    routes.notificationsPage(request, response);
  });

  // User settings.
  app.route(/^\/settings(\/\w+)?\/?$/, (data, match, end, query) => {
    const { req: request, res: response } = query;
    const { user } = request;
    if (!user) {
      routes.loginPage(request, response);
      return;
    }

    // Select the requested section, or serve the default one.
    const sectionUri = match[1];
    const section = sectionUri ? sectionUri.slice(1) : 'account';

    routes.settingsPage(request, response, section);
  });

  // New settings page.
  app.route(/^\/settings-new\/?$/, (data, match, end, query) => {
    const { req: request, res: response } = query;
    const { user } = request;
    if (!user) {
      routes.loginPage(request, response);
      return;
    }

    routes.settingsPageNew(request, response);
  });

  // User account (now part of settings).
  app.route(/^\/account\/?$/, (data, match, end, query) => {
    routes.redirect(query.res, '/settings/account/', true);
  });

  app.route(/^\/[.,;)]$/, (data, match, end, query) => {
    routes.redirect(query.res, '/', true);
  });

  // Admin sections.
  app.route(/^\/admin(\/\w+)?\/?$/, (data, match, end, query) => {
    const { req: request, res: response } = query;
    const { user } = request;
    if (!users.isAdmin(user)) {
      routes.notFoundPage(request, response);
      return;
    }

    // Select the requested section, or serve the default one.
    const sectionUri = match[1];
    const section = sectionUri ? sectionUri.slice(1) : 'docker';

    log('admin', section, '(' + user._primaryEmail + ')');

    routes.adminPage(request, response, section);
  });

  // New 404 Not Found page
  app.route(/^\/404-new\/?$/, (data, match, end, query) => {
    log('404-new', match[0]);
    routes.notFoundPageNew(query.req, query.res);
  });

  // 404 Not Found.
  app.notfound(/.*/, (data, match, end, query) => {
    log('404', match[0]);
    routes.notFoundPage(query.req, query.res);
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
    if (data.name !== 'cloud9') {
      end({ status: 'error', message: 'Unknown key name' });
      return;
    }

    // Extract a valid SSH public key from the user's input.
    // Regex adapted from https://gist.github.com/paranoiq/1932126.
    const match = data.key.match(/ssh-rsa [\w+/]+[=]{0,3}/);
    if (!match) {
      end({ status: 'error', message: 'Invalid SSH key' });
      return;
    }

    key = match[0];
    log('key', data.name, user._primaryEmail);

    user.keys[data.name] = key;
    db.save();

    end({ status: 'key-saved' });
  });
});
