// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

let boot = require('./lib/boot');
let db = require('./lib/db');
let log = require('./lib/log');
let oauth2 = require('./lib/oauth2');

// Change this to your actual hostname in './db.json':
let hostname = db.get('hostname', 'localhost');

if (!hostname || hostname === 'localhost') {
  log('[fail] cannot join cluster as [hostname = ' + hostname + ']: ' +
    'please fix the hostname in ./db.json and try again');
  return;
}

log('[ok] will try to join cluster as [hostname = ' + hostname + ']');

boot.executeInParallel([
  boot.forwardHttp,
  boot.ensureHttpsCertificates,
  boot.ensureDockerTlsCertificates,
  boot.verifyJanitorOAuth2Access
], () => {

  let { ca, client } = db.get('tls');

  let parameters = {
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
      log('[fail] unabled to join cluster:', error);
      return;
    }
    log('[ok] joined cluster as [hostname = ' + hostname + ']');
  });

});
