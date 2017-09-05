// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const camp = require('camp');
const http = require('http');
const nodepath = require('path');

const boot = require('./lib/boot');
const db = require('./lib/db');
const log = require('./lib/log');
const oauth2 = require('./lib/oauth2');
const proxyHeuristics = require('./lib/proxy-heuristics');
const routes = require('./lib/routes');
const sessions = require('./lib/sessions');

// Change this to your actual hostname in './db.json':
const hostname = db.get('hostname', 'localhost');

if (!hostname || hostname === 'localhost') {
  throw new Error('Cannot join cluster as [hostname = ' + hostname + ']: ' +
    'please fix the hostname in ./db.json and try again');
}

log('[ok] will try to join cluster as [hostname = ' + hostname + ']');

boot.executeInParallel([
  boot.forwardHttp,
  boot.ensureHttpsCertificates,
  boot.ensureDockerTlsCertificates,
  boot.verifyJanitorOAuth2Access,
  boot.loadTasks,
], () => {
  boot.registerDockerClient(() => {
    log('[ok] joined cluster as [hostname = ' + hostname + ']');

    const https = db.get('https');
    const ports = db.get('ports');
    const security = db.get('security');

    // Start an authenticated Janitor proxy for Docker containers on this host.
    const proxy = camp.start({
      documentRoot: process.cwd() + '/static',
      saveRequestChunks: true,
      port: ports.https,
      secure: !security.forceHttp,
      key: https.key,
      cert: https.crt,
      ca: https.ca
    });

    log('[ok] proxy → http' + (security.forceHttp ? '' : 's') + '://' +
      hostname + ':' + ports.https);

    // Authenticate all requests with a series of server middlewares.
    proxy.handle(ensureSession);
    proxy.handle(handleOAuth2Code);
    proxy.handle(ensureOAuth2Access);
    proxy.handle(proxyHeuristics.handleProxyUrls);

    // Proxy HTTPS requests to local containers.
    // Examples:
    //   'https://<hostname>/abc123/8080/index.html'
    //   'https://<hostname>/index.html?container=abc123&port=8080'
    //   'https://<hostname>/index.html' (Referer: '<hostname>/abc123/8080/')
    // All of these requests should route to:
    //   'http://localhost:8080/index.html' in the Docker container 'abc123'.
    proxy.path('/*', proxyRequest);

    // Proxy WebSocket connections to local containers.
    proxy.on('upgrade', (request, socket, head) => {
      // Note: 'upgrade' requests bypass any installed middlewares, so we need
      // to call them here manually to authenticate WebSocket connections.
      request.query = {};
      ensureSession(request, socket, () => {
        ensureOAuth2Access(request, socket, () => {
          // Note: We don't handle proxy URLs here, because they don't work with
          // WebSockets (no 'referer' HTTP header in WebSocket requests).
          proxyRequest(request, socket);
        });
      });
    });
  });
});

// Associate some non-persistent data to sessions.
const oauth2States = {};
const oauth2Tokens = {};

// Assign a stable session to all requests.
function ensureSession (request, response, next) {
  sessions.get(request, (error, session, token) => {
    if (error || !session || !session.id) {
      log('[fail] session:', session, error);
      response.statusCode = 500; // Internal Server Error
      response.end();
      return;
    }

    request.session = session;
    next();
  });
}

// Handle any OAuth2 authorization codes.
function handleOAuth2Code (request, response, next) {
  const { code, state } = request.query;
  if (!code) {
    next();
    return;
  }

  // Compare the provided OAuth2 state parameter with actual session state.
  const { session } = request;
  const expectedState = oauth2States[session.id];
  if (!state || String(state) !== String(expectedState)) {
    log('[fail] bad oauth2 state: got', state, 'but expected', expectedState);
    response.statusCode = 403; // Forbidden
    response.end();
    return;
  }

  // If they match, use the code to request an OAuth2 access token.
  getOAuth2AccessToken(code, state, (error, accessToken, refreshToken) => {
    if (error) {
      log('[fail] oauth2 access token', error);
      response.statusCode = 403; // Forbidden
      response.end();
      return;
    }

    // Associate the new OAuth2 access token to the current session.
    // TODO: Also save the `refreshToken` when it's fully supported.
    oauth2Tokens[session.id] = accessToken;
    next();
  });
}

// Ensure that all requests are authenticated via OAuth2.
function ensureOAuth2Access (request, response, next) {
  const { session } = request;
  if (oauth2Tokens[session.id]) {
    // This session has an OAuth2 access token, so it's authenticated.
    // TODO: Also verify that the token is still valid, or renew it if not.
    next();
    return;
  }

  // We can only use `http.ServerResponse`s to initiate OAuth2 authentication,
  // not raw `net.Socket`s (as in WebSocket connections).
  if (!(response instanceof http.ServerResponse)) {
    const error = new Error('Unsupported response type (e.g. WebSocket)');
    log('[fail] oauth2 redirect', error);
    response.end();
    return;
  }

  // Generate a new OAuth2 state parameter for this authentication attempt.
  oauth2.generateStateParameter((error, state) => {
    if (error) {
      log('[fail] oauth2 state', error);
      response.statusCode = 500; // Internal Server Error
      response.end();
      return;
    }

    oauth2States[session.id] = state;

    // Redirect the request to Janitor's OAuth2 provider for authorization.
    getOAuth2AuthorizationUrl(request.url, state, (error, url) => {
      if (error) {
        log('[fail] oauth2 authorize url:', url, error);
        response.statusCode = 500; // Internal Server Error
        response.end();
        return;
      }

      routes.redirect(response, url);
    });
  });
}

// Proxy a request to a local Docker container.
function proxyRequest (request, response) {
  const { session } = request;
  let { container, port } = request.query;
  if (!container || !port) {
    // FIXME: Containers and ports should always be explicitly requested.
    // Let's Encrypt will soon support wildcard certificates, which could allow
    // us to enforce consistently explicit proxy requests, with domains like:
    //   'https://8080.abc123.<hostname>/index.html'
    // In the meantime, we try to guess which container port this is meant for.
    const likelyProxyRequest = proxyHeuristics.guessProxyRequest(request);
    if (!likelyProxyRequest) {
      log('[fail] no container port requested', request.url);
      response.statusCode = 400; // Bad Request
      response.end();
      return;
    }

    container = request.query.container = likelyProxyRequest.container;
    port = request.query.port = likelyProxyRequest.port;
  }

  // Remember explicit proxy requests to help with future ambiguous requests.
  proxyHeuristics.rememberProxyRequest(request);

  // Use the Janitor API to check which local host port the requested Docker
  // container port is mapped to. This also verifies that the container exists
  // on this host, and that the authenticated user is allowed to access it.
  getMappedPort(oauth2Tokens[session.id], container, port, (error, data) => {
    if (error) {
      log('[fail] getting mapped port', error);
      response.statusCode = 404; // Not Found
      response.end();
      return;
    }

    routeRequest({ port: data.port, proxy: data.proxy }, request, response);
  });
}

// Route a request to the given port, using the given proxy type.
function routeRequest (proxyParameters, request, response) {
  const path = nodepath.normalize(request.url);
  if (path[0] !== '/') {
    log('[fail] invalid proxy path:', path);
    response.statusCode = 500; // Internal Server Error
    response.end();
    return;
  }

  const { port, proxy } = proxyParameters;
  switch (proxy) {
    case 'https':
      routes.webProxy(request, response, { port, path });
      break;

    case 'none':
      routes.redirect(response, 'https://' + hostname + ':' + port + path);
      break;

    default:
      log('[fail] unsupported proxy type:', proxy);
      response.statusCode = 500; // Internal Server Error
      response.end();
      break;
  }
}

// Use the Janitor API to get the mapping information of a given container port.
function getMappedPort (accessToken, container, port, callback) {
  const parameters = {
    provider: 'janitor',
    accessToken: accessToken,
    path: `/api/hosts/${hostname}/containers/${container}/${port}`
  };

  oauth2.request(parameters, (error, body, response) => {
    if (error) {
      callback(error);
      return;
    }

    const status = response.statusCode;
    if (status !== 200) {
      callback(new Error('OAuth2 port request failed: ' + status + ' ' + body));
      return;
    }

    try {
      const data = JSON.parse(body);
      callback(null, data);
    } catch (error) {
      callback(error);
    }
  });
}

// Get the Janitor OAuth2 provider's authorization URL for scope 'user:ports'.
function getOAuth2AuthorizationUrl (redirectUrl, state, callback) {
  if (!redirectUrl || redirectUrl[0] !== '/') {
    callback(new Error('Invalid redirect URL: ' + redirectUrl));
    return;
  }

  const parameters = {
    provider: 'janitor',
    options: {
      redirect_url: 'https://' + hostname + redirectUrl,
      scope: [ 'user:ports' ],
      state
    }
  };

  oauth2.getAuthorizationUrl(parameters, (error, url) => {
    callback(error, url);
  });
}

// Request an OAuth2 access token in exchange of an authorization code.
function getOAuth2AccessToken (code, state, callback) {
  const parameters = {
    provider: 'janitor',
    options: { state },
    code
  };

  oauth2.getAccessToken(parameters, (error, accessToken, refreshToken) => {
    callback(error, accessToken, refreshToken);
  });
}
