// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

let http = require('http');

let certificates = require('./certificates');
let db = require('./db');
let log = require('./log');

let hostname = db.get('hostname', 'localhost');


// Run given tasks in parrallel, and only call `next()` when all have succeeded.

function executeInParallel (tasks, next) {

  let complete = 0;

  for (let task of tasks) {
    try {
      task(() => {
        complete++;
        if (complete === tasks.length) {
          next();
        }
      });
    } catch (error) {
      log('[fail] boot task', error);
    }
  }

}

exports.executeInParallel = executeInParallel;


// Permanently redirect all HTTP requests to HTTPS.

function forwardHttp (next) {

  let ports = db.get('ports');
  if (!ports.http || !ports.https) {
    // Use `make ports` to set up this unprivileged HTTP port.
    ports.http = ports.http || 1080;
    ports.https = ports.https || 1443;
  }

  let forwarder = http.Server((request, response) => {

    // Make an exception for Let's Encrypt HTTP challenges.
    if (request.url.startsWith(certificates.letsEncryptChallengePrefix)) {
      let token = certificates.getLetsEncryptChallengeToken(request.url);
      if (token) {
        log('[ok] served letsencrypt http challenge token');
        response.end(token);
        return;
      }
    }

    let url = 'https://' + request.headers.host + request.url;
    response.statusCode = 301;
    response.setHeader('Location', url);
    response.end();

  });

  forwarder.listen(ports.http , () => {
    log('[ok] forwarding http:// → https://');
    next();
  });

}

exports.forwardHttp = forwardHttp;


// Verify HTTPS certificates, generate new ones if necessary.

function ensureHttpsCertificates (next) {

  let https = db.get('https');

  let valid = certificates.isValid({
    ca: https.ca,
    crt: https.crt,
    key: https.key,
    hostname: hostname
  });

  if (valid) {
    log('[ok] verified https credentials');
    next();
    return;
  }

  let letsencrypt = db.get('letsencrypt');
  if (!letsencrypt.email) {
    letsencrypt.email = 'you@example.com';
  }

  let parameters = {
    hostname: hostname,
    accountEmail: letsencrypt.email
  };

  if (letsencrypt.key) {
    parameters.accountKey = letsencrypt.key;
  }

  log('requesting new https credentials…');
  certificates.createHTTPSCertificate(parameters, (error, certificate, accountKey) => {
    if (error) {
      log('[fail] letsencrypt', error);
      return;
    }
    https.ca = [ certificate.ca ];
    https.crt = certificate.cert;
    https.key = certificate.privkey;
    letsencrypt.key = accountKey;
    db.save();
    log('[ok] new https credentials installed');
    next();
  });

}

exports.ensureHttpsCertificates = ensureHttpsCertificates;
