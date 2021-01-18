// Copyright © 2016 Team Janitor. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const camp = require('camp');
const http = require('http');
const nodepath = require('path');

const boot = require('./lib/boot');
const db = require('./lib/db');
const events = require('./lib/events');
const log = require('./lib/log');
const oauth2 = require('./lib/oauth2');
const proxyHeuristics = require('./lib/proxy-heuristics');
const routes = require('./lib/routes');
const sessions = require('./lib/sessions');

// Add your actual server hostnames in './db.json':
const hostnames = db.get('hostnames', ['localhost']);

if (!hostnames || hostnames[0] === 'localhost') {
  throw new Error(`Cannot join cluster as [hostname = ${hostnames[0]}: ` +
    'please fix the first hostname in ./db.json and try again');
}

log(`[ok] will try to join cluster as [hostname = ${hostnames[0]}]`);

boot.executeInParallel([
  boot.forwardHttp,
  boot.ensureHttpsCertificates,
  boot.ensureDockerTlsCertificates,
  boot.verifyJanitorOAuth2Access
], () => {
  boot.registerDockerClient(() => {
    log('[ok] joined cluster as [hostname = ' + hostnames[0] + ']');

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
      hostnames[0] + ':' + ports.https);

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
          proxyHeuristics.handleProxyUrls(request, socket, () => {
            proxyRequest(request, socket);
          });
        });
      });
    });

    // Start regularly scheduling system events, once start-up is complete.
    events.startScheduling();
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
async function handleOAuth2Code (request, response, next) {
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
  try {
    // Associate the new OAuth2 access token to the current session.
    // TODO: Also save the `refreshToken` when it's fully supported.
    const { accessToken } = await getOAuth2AccessToken(code, state);
    oauth2Tokens[session.id] = accessToken;
  } catch (error) {
    log('[fail] oauth2 access token', error);
    response.statusCode = 403; // Forbidden
    response.end();
    return;
  }

  const requestUrl = new URL(request.url);
  if (!requestUrl.search) {
    // There are no URL parameters to remove, proceed without redirection.
    next();
    return;
  }

  // Remove the used OAuth2 code and state parameters from the requested URL.
  requestUrl.searchParams.delete('code');
  requestUrl.searchParams.delete('state');

  // Redirect the request to a safer URL (which can be revisited without 403).
  routes.redirect(response, requestUrl.href, true);
}

// Ensure that all requests are authenticated via OAuth2.
async function ensureOAuth2Access (request, response, next) {
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

  try {
    // Generate a new OAuth2 state parameter for this authentication attempt.
    const state = await oauth2.generateStateParameter();
    oauth2States[session.id] = state;

    // Redirect the request to Janitor's OAuth2 provider for authorization.
    const url = await getOAuth2AuthorizationUrl(request.url, state);
    routes.redirect(response, url);
  } catch (error) {
    log('[fail] could not redirect to oauth2 provider', error);
    response.statusCode = 500; // Internal Server Error
    response.end();
  }
}

// Proxy a request to a local Docker container.
async function proxyRequest (request, response) {
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

  try {
    // Use the Janitor API to check which local host port the requested Docker
    // container port is mapped to. This also ensures that the container exists
    // on this host, and that the authenticated user is allowed to access it.
    const data = await getMappedPort(oauth2Tokens[session.id], container, port);
    routeRequest({ port: data.port, proxy: data.proxy }, request, response);
  } catch (error) {
    log('[fail] getting mapped port', error);
    response.statusCode = 404; // Not Found
    response.end();
  }
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
      // Route this request through an authenticated HTTPS proxy, which gets its
      // content from a locally-restricted HTTP port.
      routes.webProxy(request, response, { port, path });
      break;

    case 'none':
      // Don't route, simply redirect this request to a different public port.
      routes.redirect(response, 'https://' + request.headers.host + ':' + port + path);
      break;

    default:
      log('[fail] unsupported proxy type:', proxy);
      response.statusCode = 500; // Internal Server Error
      response.end();
      break;
  }
}

// Use the Janitor API to get the mapping information of a given container port.
async function getMappedPort (accessToken, container, port) {
  const parameters = {
    provider: 'janitor',
    accessToken: accessToken,
    path: `/api/hosts/${hostnames[0]}/containers/${container}/${port}`
  };

  const { body, response } = await oauth2.request(parameters);
  const { statusCode } = response;
  if (statusCode !== 200) {
    throw new Error('OAuth2 port request failed: ' + statusCode + ' ' + body);
  }

  return JSON.parse(body);
}

// Get the Janitor OAuth2 provider's authorization URL for scope 'user:ports'.
async function getOAuth2AuthorizationUrl (redirectUrl, state) {
  if (!redirectUrl || redirectUrl[0] !== '/' || redirectUrl[1] === '/') {
    throw new Error('Invalid redirect URL: ' + redirectUrl);
  }

  const parameters = {
    provider: 'janitor',
    options: {
      redirect_url: 'https://' + hostnames[0] + redirectUrl,
      scope: ['user:ports'],
      state
    }
  };

  return oauth2.getAuthorizationUrl(parameters);
}

// Request an OAuth2 access token in exchange of an authorization code.
async function getOAuth2AccessToken (code, state) {
  const parameters = {
    provider: 'janitor',
    options: { state },
    code
  };

  return oauth2.getAccessToken(parameters);
}
