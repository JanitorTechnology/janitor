// Copyright © 2016 Team Janitor. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const camp = require('camp');
const selfapi = require('selfapi');

const api = require('./api/');
const blog = require('./lib/blog');
const boot = require('./lib/boot');
const db = require('./lib/db');
const events = require('./lib/events');
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
  const hostnames = db.get('hostnames', ['localhost']);
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
    if (!requestedHostname || !hostnames.includes(requestedHostname)) {
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

  // Public landing page (legacy).
  app.route(/^\/landing-new\/?$/, (data, match, end, query) => {
    routes.redirect(query.res, '/', true);
  });

  // Public API (when wrongly used with a trailing '/').
  app.route(/^\/api\/(.+)\/$/, (data, match, end, query) => {
    routes.redirect(query.res, '/api/' + match[1], true);
  });

  // Public API reference.
  app.route(/^\/reference\/api\/?$/, (data, match, end, query) => {
    log('api reference');
    routes.apiPage(query.req, query.res, api);
  });

  // Public API reference page (legacy).
  app.route(/^\/reference\/api-new\/?$/, (data, match, end, query) => {
    routes.redirect(query.res, '/reference/api/', true);
  });

  // Public about page.
  app.route(/^\/about\/?$/, (data, match, end, query) => {
    const { req: request, res: response } = query;
    log('about');
    routes.aboutPage(request, response);
  });

  // Public blog page.
  app.route(/^\/blog\/?$/, (data, match, end, query) => {
    const { req: request, res: response } = query;
    log('blog');
    routes.blogPage(request, response, blog);
  });

  // Public blog page (legacy).
  app.route(/^\/blog-new\/?$/, (data, match, end, query) => {
    routes.redirect(query.res, '/blog/', true);
  });

  // Public live data page.
  app.route(/^\/data\/?$/, (data, match, end, query) => {
    routes.dataPage(query.req, query.res);
  });

  // Public live data page (legacy).
  app.route(/^\/data-new\/?$/, (data, match, end, query) => {
    routes.redirect(query.res, '/data/', true);
  });

  // Public design page
  app.route(/^\/design\/?$/, (data, match, end, query) => {
    routes.designPage(query.req, query.res);
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

  // Public projects page (legacy).
  app.route(/^\/projects-new\/?$/, (data, match, end, query) => {
    routes.redirect(query.res, '/projects/', true);
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

    routes.redirect(query.res, '/containers/');
  });

  // Request a log-in key via email.
  app.route(/^\/login\/email\/?$/, async (data, match, end, query) => {
    const { req: request, res: response } = query;
    const { user, method } = request;

    if (method !== 'POST') {
      response.statusCode = 404;
      response.end();
      return;
    }

    if (user) {
      response.statusCode = 400;
      response.json({ error: 'Already logged in, refresh the page.' }, null, 2);
      return;
    }

    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      try {
        const json = Buffer.concat(chunks).toString();
        const { email } = JSON.parse(json);
        users.sendLoginEmail(email, query.req, error => {
          if (error) {
            const message = String(error);
            log(message, '(while emailing ' + email + ')');
            response.statusCode = 500;
            response.json({ error: 'Failed to email you' }, null, 2);
            return;
          }
          response.json({ message: 'You should receive an email shortly' }, null, 2);
        });
      } catch (error) {
        log('[fail] login', error);
        response.statusCode = 400; // Bad Request
        response.json({ error: 'Invalid request' }, null, 2);
      }
    });
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

    routes.redirect(response, '/settings/');
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

  // User containers list (legacy).
  app.route(/^\/containers-new\/?$/, (data, match, end, query) => {
    routes.redirect(query.res, '/containers/', true);
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

  // Old user settings.
  app.route(/^\/settings-old(\/\w+)?\/?$/, (data, match, end, query) => {
    const { req: request, res: response } = query;
    const { user } = request;
    if (!user) {
      routes.loginPage(request, response);
      return;
    }

    // Select the requested section, or serve the default one.
    const sectionUri = match[1];
    const section = sectionUri ? sectionUri.slice(1) : 'account';

    routes.settingsPageOld(request, response, section);
  });

  // User settings page.
  app.route(/^\/settings\/?$/, (data, match, end, query) => {
    const { req: request, res: response } = query;
    const { user } = request;
    if (!user) {
      routes.loginPage(request, response);
      return;
    }

    routes.settingsPage(request, response);
  });

  // User settings page (legacy).
  app.route(/^\/settings-new\/?$/, (data, match, end, query) => {
    routes.redirect(query.res, '/settings/');
  });

  app.route(/^\/settings\/account\/?$/, (data, match, end, query) => {
    routes.redirect(query.res, '/settings/');
  });

  app.route(/^\/settings\/configurations\/?$/, (data, match, end, query) => {
    routes.redirect(query.res, '/settings/');
  });

  app.route(/^\/settings\/integrations\/?$/, (data, match, end, query) => {
    routes.redirect(query.res, '/settings/');
  });

  app.route(/^\/settings\/preferences\/?$/, (data, match, end, query) => {
    routes.redirect(query.res, '/settings/');
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

  // 404 Not Found.
  app.notfound(/.*/, (data, match, end, query) => {
    log('404', match[0]);
    routes.notFoundPage(query.req, query.res);
  });

  // Alpha version sign-up.
  app.route(/^\/signup\/?$/, (data, match, end, query) => {
    const { req: request, res: response } = query;
    const { user, method } = request;

    if (method !== 'POST') {
      response.statusCode = 404;
      response.end();
      return;
    }

    if (user) {
      response.statusCode = 400;
      response.json({ error: 'Already logged in, log out to sign up.' }, null, 2);
      return;
    }

    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      try {
        const json = Buffer.concat(chunks).toString();
        const { email } = JSON.parse(json);
        const users = db.get('users');
        const waitlist = db.get('waitlist');

        log('signup', email);

        if (waitlist[email]) {
          response.json({ message: 'Already in the waitlist.' });
          return;
        }

        if (users[email]) {
          response.statusCode = 400;
          response.json({ error: 'Already signed up.' });
          return;
        }

        waitlist[email] = Date.now();
        db.save();

        response.json({ message: 'Added to waitlist.' });
      } catch (e) {
        response.statusCode = 400;
        response.json({ message: 'Oh noes, your request went wrong.' });
      }
    });
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

  // Start regularly scheduling system events, once start-up is complete.
  events.startScheduling();
});
