// Copyright © 2016 Team Janitor. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const fs = require('fs');
const http = require('http');

const certificates = require('./certificates');
const db = require('./db');
const log = require('./log');
const oauth2 = require('./oauth2');

const hostnames = db.get('hostnames', ['localhost']);

// Run given tasks in parrallel, and only call `next()` when all have succeeded.
exports.executeInParallel = function (tasks, next) {
  let complete = 0;

  for (const task of tasks) {
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
};

// Permanently redirect all HTTP requests to HTTPS.
exports.forwardHttp = function (next) {
  const ports = db.get('ports');
  if (!ports.http || !ports.https) {
    // Use `make ports` to set up this unprivileged HTTP port.
    ports.http = ports.http || 1080;
    ports.https = ports.https || 1443;
  }

  const forwarder = http.Server((request, response) => {
    // Make an exception for Let's Encrypt HTTP challenges.
    if (request.url.startsWith(certificates.letsEncryptChallengePrefix)) {
      const token = certificates.getLetsEncryptChallengeToken(request.url);
      if (token) {
        log('[ok] served letsencrypt http challenge token');
        response.end(token);
        return;
      }
    }

    const url = 'https://' + request.headers.host + request.url;
    response.statusCode = 301;
    response.setHeader('Location', url);
    response.end();
  });

  forwarder.listen(ports.http, () => {
    log('[ok] forwarding http:// → https://');
    next();
  });
};

// Verify HTTPS certificates and generate new ones if necessary.
exports.ensureHttpsCertificates = function (next) {
  if (db.get('security').forceHttp) {
    log('[warning] skipped https credentials verification');
    next();
    return;
  }

  const https = db.get('https');
  const valid = certificates.isValid({
    ca: https.ca,
    crt: https.crt,
    key: https.key,
    hostnames
  });

  if (valid) {
    log('[ok] verified https credentials');
    next();
    return;
  }

  const letsencrypt = db.get('letsencrypt');
  if (!letsencrypt.email) {
    const email = 'admin@' + hostnames[0];
    log('[warning] no letsencrypt email in ./db.json, using ' + email);
    letsencrypt.email = email;
  }

  const parameters = {
    hostnames,
    accountEmail: letsencrypt.email
  };

  if (letsencrypt.key) {
    parameters.accountKey = letsencrypt.key;
  }

  log('requesting new https credentials…');
  certificates.createHTTPSCertificate(parameters)
    .then(({ certificate, accountKey }) => {
      https.ca = [certificate.ca];
      https.crt = certificate.cert;
      https.key = certificate.privkey;
      letsencrypt.key = accountKey;
      db.save();
      log('[ok] new https credentials installed');
      next();
    })
    .catch(error => {
      log('[fail] letsencrypt', error);
    });
};

// Verify Docker TLS certificates, generate new ones if necessary.
exports.ensureDockerTlsCertificates = function (next) {
  // Read all TLS certificates.
  const tls = db.get('tls');
  const ca = tls.ca || {};
  const client = tls.client || {};
  const server = {};

  try {
    server.ca = fs.readFileSync('./docker.ca', 'utf8');
    server.crt = fs.readFileSync('./docker.crt', 'utf8');
    server.key = fs.readFileSync('./docker.key', 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      log('[fail] could not read docker-tls certificates', error);
      return;
    }
  }

  let caValid = certificates.isValid({
    crt: ca.crt,
    key: ca.key
  });
  let clientValid = false;
  let serverValid = false;

  if (!caValid) {
    resetAllCertificates();
    return;
  }

  clientValid = certificates.isValid({
    ca: [ca.crt],
    crt: client.crt,
    key: client.key
  });

  serverValid = certificates.isValid({
    ca: [ca.crt],
    crt: server.crt,
    key: server.key,
    hostnames,
  }) && (server.ca.trim() === ca.crt.trim());

  if (caValid && clientValid && serverValid) {
    log('[ok] verified docker-tls credentials');
    next();
    return;
  }

  if (!clientValid) {
    resetClientCertificate();
  }

  if (!serverValid) {
    resetServerCertificate();
  }

  // Task: Reset the TLS certificate authority, then all depending certificates.
  function resetAllCertificates () {
    const parameters = {
      commonName: 'ca',
      basicConstraints: { cA: true },
      keyUsage: {
        keyCertSign: true,
        digitalSignature: true,
        keyEncipherment: true
      }
    };

    log('generating new docker-tls certificate authority…');
    certificates.createTLSCertificate(parameters).then(({ crt, key }) => {
      ca.crt = crt;
      ca.key = key;
      tls.ca = ca;
      caValid = true;
      resetClientCertificate();
      resetServerCertificate();
    }).catch(error => {
      log('[fail] tls', error);
    });
  }

  // Task: Reset the TLS client certificate.
  function resetClientCertificate () {
    const parameters = {
      commonName: 'client',
      extKeyUsage: {
        clientAuth: true
      },
      caCrt: ca.crt,
      caKey: ca.key
    };

    log('generating new docker-tls client certificate…');
    certificates.createTLSCertificate(parameters).then(({ crt, key }) => {
      client.crt = crt;
      client.key = key;
      tls.client = client;
      clientValid = true;
      done();
    }).catch(error => {
      log('[fail] tls', error);
    });
  }

  // Task: Reset the TLS server certificate.
  function resetServerCertificate () {
    const parameters = {
      commonName: hostnames[0],
      altNames: hostnames.slice(1),
      caCrt: ca.crt,
      caKey: ca.key
    };

    log('generating new docker-tls server certificate…');
    certificates.createTLSCertificate(parameters).then(({ crt, key }) => {
      server.crt = crt;
      server.key = key;
      const filesToWrite = {
        './docker.ca': ca.crt,
        './docker.crt': server.crt,
        './docker.key': server.key
      };

      for (const file in filesToWrite) {
        const path = file;
        const value = filesToWrite[path];
        fs.writeFile(path, value, (error) => {
          if (error) {
            log('[fail] unable to write ' + path, error);
            return;
          }

          fs.chmod(path, 0o600 /* read + write by owner */, (error) => {
            if (error) {
              log('[fail] unable to protect ' + path, error);
              return;
            }

            delete filesToWrite[path];
            if (Object.keys(filesToWrite).length === 0) {
              // FIXME: Can we force the docker daemon to restart here, or to
              // switch certificates? Maybe we can do something like this:
              //   `exec('sudo service docker restart')` ?
              log('[fail] please manually restart the docker daemon');
              // But continue anyway.
              serverValid = true;
              done();
            }
          });
        });
      }
    }).catch(error => {
      log('[fail] tls', error);
    });
  }

  // Wait for all required tasks to finish before proceeding.
  function done () {
    if (!caValid || !clientValid || !serverValid) {
      // Some tasks are not finished yet. Let's wait.
      return;
    }

    // eslint-disable-next-line no-func-assign
    done = null;
    db.save();
    log('[ok] new docker-tls credentials installed');
    next();
  }
};

// Verify OAuth2 client access to a Janitor instance (for cluster hosts).
exports.verifyJanitorOAuth2Access = function (next) {
  const parameters = {
    provider: 'janitor',
    path: '/api/hosts/' + hostnames[0],
    serviceRequest: true
  };

  oauth2.request(parameters).then(({ body, response }) => {
    log('[ok] verified janitor-oauth2 access');
    next();
  }).catch(error => {
    log('[fail] janitor-oauth2 access problem', error);
  });
};

// Provide our Docker TLS client certificates to the Janitor instance.
exports.registerDockerClient = function (next) {
  const { ca, client } = db.get('tls');
  const parameters = {
    provider: 'janitor',
    path: '/api/hosts/' + hostnames[0],
    data: {
      port: 2376,
      ca: ca.crt,
      crt: client.crt,
      key: client.key
    },
    method: 'POST',
    serviceRequest: true
  };

  oauth2.request(parameters).then(({ body, response }) => {
    log('[ok] registered docker-tls credentials');
    next();
  }).catch(error => {
    log('[fail] unable to register docker-tls credentials:', error);
  });
};
