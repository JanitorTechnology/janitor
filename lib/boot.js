// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const fs = require('fs');
const http = require('http');
const { promisify } = require('util');
const chmod = promisify(fs.chmod);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

const certificates = require('./certificates');
const db = require('./db');
const log = require('./log');
const oauth2 = require('./oauth2');

const hostname = db.get('hostname', 'localhost');

// Permanently redirect all HTTP requests to HTTPS.
exports.forwardHttp = function () {
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

  const listen = promisify(forwarder.listen);
  return listen.call(forwarder, ports.http);
};

// Verify HTTPS certificates and generate new ones if necessary.
exports.ensureHttpsCertificates = async function () {
  if (db.get('security').forceHttp) {
    log('[warning] skipped https credentials verification');
    return;
  }

  const https = db.get('https');
  const valid = certificates.isValid({
    ca: https.ca,
    crt: https.crt,
    key: https.key,
    hostname: hostname
  });

  if (valid) {
    log('[ok] verified https credentials');
    return;
  }

  const letsencrypt = db.get('letsencrypt');
  if (!letsencrypt.email) {
    const email = 'admin@' + hostname;
    log('[warning] no letsencrypt email in ./db.json, using ' + email);
    letsencrypt.email = email;
  }

  const parameters = {
    hostname: hostname,
    accountEmail: letsencrypt.email
  };

  if (letsencrypt.key) {
    parameters.accountKey = letsencrypt.key;
  }

  log('requesting new https credentials…');
  return certificates.createHTTPSCertificate(parameters)
    .then(({ certificate, accountKey }) => {
      https.ca = [ certificate.ca ];
      https.crt = certificate.cert;
      https.key = certificate.privkey;
      letsencrypt.key = accountKey;
      db.save();
      log('[ok] new https credentials installed');
    });
};

// Verify Docker TLS certificates, generate new ones if necessary.
exports.ensureDockerTlsCertificates = async function () {
  // Read all TLS certificates.
  const tls = db.get('tls');
  const ca = tls.ca || {};
  const client = tls.client || {};
  const server = {};

  try {
    server.ca = await readFile('./docker.ca', 'utf8');
    server.crt = await readFile('./docker.crt', 'utf8');
    server.key = await readFile('./docker.key', 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      log('[fail] could not read docker-tls certificates', error);
    }
    throw error;
  }

  let caValid = certificates.isValid({
    crt: ca.crt,
    key: ca.key
  });
  let clientValid = false;
  let serverValid = false;

  if (!caValid) {
    await resetAllCertificates();
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
    return;
  }

  if (!clientValid) {
    await resetClientCertificate();
  }

  if (!serverValid) {
    await resetServerCertificate();
  }

  // Task: Reset the TLS certificate authority, then all depending certificates.
  async function resetAllCertificates () {
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
    const { crt, key } = await certificates.createTLSCertificate(parameters);
    ca.crt = crt;
    ca.key = key;
    tls.ca = ca;
    caValid = true;
    await resetClientCertificate();
    await resetServerCertificate();
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
    return certificates.createTLSCertificate(parameters).then(({ crt, key }) => {
      client.crt = crt;
      client.key = key;
      tls.client = client;
      clientValid = true;
    });
  }

  // Task: Reset the TLS server certificate.
  async function resetServerCertificate () {
    const parameters = {
      commonName: hostname,
      altNames: [ 'localhost' ],
      caCrt: ca.crt,
      caKey: ca.key
    };

    log('generating new docker-tls server certificate…');
    const { crt, key } = await certificates.createTLSCertificate(parameters);
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
      try {
        await writeFile(path, value);
      } catch (error) {
        log('[fail] unable to write ' + path, error);
        throw error;
      }
      try {
        await chmod(path, 0o600 /* read + write by owner */);
      } catch (error) {
        log('[fail] unable to protect ' + path, error);
        throw error;
      }

      delete filesToWrite[path];
      if (Object.keys(filesToWrite).length === 0) {
        // FIXME: Can we force the docker daemon to restart here, or to
        // switch certificates? Maybe we can do something like this:
        //   `exec('sudo service docker restart')` ?
        log('[warning] please manually restart the docker daemon');
        // But continue anyway.
        serverValid = true;
      }
    }
  }

  db.save();
  log('[ok] new docker-tls credentials installed');
};

// Verify OAuth2 client access to a Janitor instance (for cluster hosts).
exports.verifyJanitorOAuth2Access = async function () {
  const parameters = {
    provider: 'janitor',
    path: '/api/hosts/' + hostname,
    serviceRequest: true
  };

  await oauth2.request(parameters);
  log('[ok] verified janitor-oauth2 access');
};

// Provide our Docker TLS client certificates to the Janitor instance.
exports.registerDockerClient = async function () {
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

  await oauth2.request(parameters);
  log('[ok] registered docker-tls credentials');
};
