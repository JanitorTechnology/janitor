// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

let fs = require('fs');
let http = require('http');

let certificates = require('./certificates');
let db = require('./db');
let log = require('./log');
let oauth2 = require('./oauth2');

let hostname = db.get('hostname', 'localhost');

// Run given tasks in parrallel, and only call `next()` when all have succeeded.
exports.executeInParallel = function (tasks, next) {
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
};

// Permanently redirect all HTTP requests to HTTPS.
exports.forwardHttp = function (next) {
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
};

// Verify HTTPS certificates, generate new ones if necessary.
exports.ensureHttpsCertificates = function (next) {
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
    let email = 'admin@' + hostname;
    log('[warning] no letsencrypt email in ./db.json, using ' + email);
    letsencrypt.email = email;
  }

  let parameters = {
    hostname: hostname,
    accountEmail: letsencrypt.email
  };

  if (letsencrypt.key) {
    parameters.accountKey = letsencrypt.key;
  }

  let onCertificate = (error, certificate, accountKey) => {
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
  };

  log('requesting new https credentials…');
  certificates.createHTTPSCertificate(parameters, onCertificate);
};

// Verify Docker TLS certificates, generate new ones if necessary.
exports.ensureDockerTlsCertificates = function (next) {
  // Read all TLS certificates.
  let tls = db.get('tls');
  let ca = tls.ca || {};
  let client = tls.client || {};
  let server = {};

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
    ca: [ ca.crt ],
    crt: client.crt,
    key: client.key
  });

  serverValid = certificates.isValid({
    ca: [ ca.crt ],
    crt: server.crt,
    key: server.key,
    hostname: hostname
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
    let parameters = {
      commonName: 'ca',
      basicConstraints: { cA: true },
      keyUsage: {
        keyCertSign: true,
        digitalSignature: true,
        keyEncipherment: true
      }
    };
    log('generating new docker-tls certificate authority…');
    certificates.createTLSCertificate(parameters, (error, crt, key) => {
      if (error) {
        log('[fail] tls', error);
        return;
      }
      ca.crt = crt;
      ca.key = key;
      tls.ca = ca;
      caValid = true;
      resetClientCertificate();
      resetServerCertificate();
    });
  }

  // Task: Reset the TLS client certificate.
  function resetClientCertificate () {
    let parameters = {
      commonName: 'client',
      extKeyUsage: {
        clientAuth: true
      },
      caCrt: ca.crt,
      caKey: ca.key
    };
    log('generating new docker-tls client certificate…');
    certificates.createTLSCertificate(parameters, (error, crt, key) => {
      if (error) {
        log('[fail] tls', error);
        return;
      }
      client.crt = crt;
      client.key = key;
      tls.client = client;
      clientValid = true;
      done();
    });
  }

  // Task: Reset the TLS server certificate.
  function resetServerCertificate () {
    let parameters = {
      commonName: hostname,
      altNames: [ 'localhost' ],
      caCrt: ca.crt,
      caKey: ca.key
    };
    log('generating new docker-tls server certificate…');
    certificates.createTLSCertificate(parameters, (error, crt, key) => {
      if (error) {
        log('[fail] tls', error);
        return;
      }
      server.crt = crt;
      server.key = key;
      let filesToWrite = {
        './docker.ca': ca.crt,
        './docker.crt': server.crt,
        './docker.key': server.key
      };
      for (let file in filesToWrite) {
        let path = file;
        let value = filesToWrite[path];
        fs.writeFile(path, value, (error) => {
          if (error) {
            log('[fail] unable to write ' + path, error);
            return;
          }
          fs.chmod(path, 0600 /* read + write by owner */, (error) => {
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
    });
  }

  // Wait for all required tasks to finish before proceeding.
  function done () {
    if (!caValid || !clientValid || !serverValid) {
      // Some tasks are not finished yet. Let's wait.
      return;
    }
    done = null;
    db.save();
    log('[ok] new docker-tls credentials installed');
    next();
  }
};

// Verify OAuth2 client access to a Janitor instance (for cluster hosts).
exports.verifyJanitorOAuth2Access = function (next) {
  let parameters = {
    provider: 'janitor',
    path: '/api/hosts/' + hostname,
    serviceRequest: true
  };

  oauth2.request(parameters, (error, body, response) => {
    if (error) {
      log('[fail] janitor-oauth2 access problem', error);
      return;
    }
    log('[ok] verified janitor-oauth2 access');
    next();
  });
};

// Provide our Docker TLS client certificates to the Janitor instance.
exports.registerDockerClient = function (next) {
  const { ca, client } = db.get('tls');
  const parameters = {
    provider: 'janitor',
    path: '/api/hosts/' + hostname,
    data: {
      port: 2376,
      ca: ca.crt,
      crt: client.crt,
      key: client.key
    },
    method: 'POST',
    serviceRequest: true
  };

  oauth2.request(parameters, (error, body, response) => {
    if (error) {
      log('[fail] unable to register docker-tls credentials:', error);
      return;
    }

    log('[ok] registered docker-tls credentials');
    next();
  });
};

