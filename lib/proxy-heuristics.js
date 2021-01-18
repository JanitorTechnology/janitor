// Copyright © 2017 Team Janitor. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const http = require('http');

const log = require('./log');
const routes = require('./routes');

// In this regex, we expect:
// - a 16+ hex-digit container ID.
// - a numeric port.
// - an optional path that starts with a '/'.
// These anonymous patterns will be captured in a `match` array as `match[1]`,
// `match[2]` and maybe `match[3]`.
exports.proxyUrlPrefix = /^\/([0-9a-f]{16,})\/(\d+)(\/.*)?$/;

// Parse request URLs (or referer URLs) that look like '/:container/:port/*' to
// identify which container ID and port a request should be proxied to.
exports.handleProxyUrls = function (request, response, next) {
  let url = null;
  let containerId = null;
  let port = null;
  let path = null;

  // Look for a container ID and port in `request.url`.
  let match = exports.proxyUrlPrefix.exec(request.url);
  if (match) {
    [url, containerId, port, path] = match;

    // We want the proxied `path` to always begin with a '/'.
    // However `path` is empty in URLs like '/abc123/8080?p=1', so we redirect
    // them to '/abc123/8080/?p=1' (where `path` is '/').
    if (!path) {
      // We can only use `http.ServerResponse`s to redirect,
      // not raw `net.Socket`s (as in WebSocket connections).
      if (!(response instanceof http.ServerResponse)) {
        const error = new Error('Unsupported response type (e.g. WebSocket)');
        log('[fail] trailing slash redirect', error);
        response.end();
        return;
      }
      url = url.includes('?') ? url.replace('?', '/?') : url + '/';
      routes.redirect(response, url, true);
      return;
    }

    // Locally remove the prefix from `request.url`.
    request.url = request.url.replace('/' + containerId + '/' + port, '');
  } else if (request.headers.referer) {
    // Look for a container ID and port in `request.headers.referer`.
    const referer = new URL(request.headers.referer);
    match = exports.proxyUrlPrefix.exec(referer.pathname);
    if (match) {
      [url, containerId, port, path] = match;
    }
  }

  if (containerId && port) {
    // Add the requested container ID and port to `request.query`.
    request.query.container = containerId;
    request.query.port = port;
  }

  next();
};

// FIXME: Remove all these heuristics when containers and ports are explicitly
// specified in every request, e.g. via domains like:
//   'https://8080.abc123.<hostname>/index.html'

// Some Cloud9 request URLs seem to include a stable ID, like in:
//   '/vfs/1/9cfNR5XK83uYCUk1/socket/?access_token=token&transport=websocket'
// We can use this prefix to associate ambiguous requests to their container.
exports.cloud9VfsUrlPrefix = /^\/vfs\/\d+\/[A-Za-z0-9]{8,}\//;

// These heuristic functions can evaluate if an ambiguous proxy request is
// intended for a specific port or not.
// They can return:
//    true: likely for this port
//   false: likely NOT for this port
exports.requestLikelyForPort = {
  8088: function ({ url }) { return url === '/websockify'; },
  8089: function ({ url }) {
    if (url.startsWith('/static/') || url === '/_ping') {
      return true;
    }
    if (this._cloud9VfsUrlPrefix) {
      return url.startsWith(this._cloud9VfsUrlPrefix);
    }
    const match = exports.cloud9VfsUrlPrefix.exec(url);
    if (match) {
      this._cloud9VfsUrlPrefix = match[0];
      return true;
    }
    return false;
  }
};

// Associate some non-persistent data to sessions.
const pastFewProxyRequests = {};

// Remember explicit proxy requests in this session for later use.
exports.rememberProxyRequest = function (request) {
  const { session } = request;
  const { container, port } = request.query;
  if (!container || !port) {
    // This request isn't helpful. Let's not remember it.
    log('[fail] will not remember unhelpful proxy request:',
      request.url, request.headers);
    return;
  }

  let pastRequests = pastFewProxyRequests[session.id];
  if (!pastRequests) {
    // This is the first request in this session.
    pastRequests = pastFewProxyRequests[session.id] = [];
  } else {
    // Only remember a requested container port once.
    for (let i = 0; i < pastRequests.length; i++) {
      const pastRequest = pastRequests[i];
      if (pastRequest.container === container && pastRequest.port === port) {
        // We already knew this request. Let's forget the old one.
        pastRequests.splice(i, 1); // Remove 1 item at position i.
        break;
      }
    }
  }

  // If we have a likeliness heuristic function for this port, remember it too.
  const likely = exports.requestLikelyForPort[port];
  pastRequests.unshift({ container, port, likely });

  // Don't remember too many old requests.
  if (pastRequests.length > 20) {
    pastRequests.pop();
  }
};

// Try to guess which container and port this ambiguous request is for.
exports.guessProxyRequest = function (request) {
  const pastRequests = pastFewProxyRequests[request.session.id];
  if (!pastRequests || pastRequests.length <= 0) {
    // We don't know any past requests for this session. Give up.
    return null;
  }

  // Compute the likeliness of each previously requested container port for this
  // new ambiguous request.
  // Scores:
  //    1: likely
  //    0: neutral
  //   -1: unlikely
  const rankedRequests = pastRequests.map((pastRequest, index) => {
    let score = 0;
    if (typeof pastRequest.likely === 'function') {
      score = pastRequest.likely(request) ? 1 : -1;
    }
    const { container, port } = pastRequest;
    return { index, container, port, score };
  });

  // Sort solutions according to their likeliness score.
  rankedRequests.sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score;
    }
    // If the score is the same, keep the original order (for stable sorting).
    return a.index - b.index;
  });

  // Phew! We've identified the most likely requested container and port.
  const { container, port, score } = rankedRequests[0];
  if (score < 0) {
    // Actually, it still looks unlikely. Give up.
    return null;
  }

  if (score === 0) {
    log('[fail] no proxy heuristic for url:', request.url,
      'headers:', request.headers);
  }

  return { container, port };
};
