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
  boot.registerDockerClient(() => {
    log('[ok] joined cluster as [hostname = ' + hostname + ']');
  });
});
