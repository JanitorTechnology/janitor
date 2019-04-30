// Copyright © 2017 Team Janitor. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const selfapi = require('selfapi');
const stream = require('stream');

if (path.basename(process.cwd()) !== 'tests') {
  console.error('Warning: Tests need to run inside the tests/ folder.\n' +
    '  This is to prevent interference between tests and production.\n' +
    '  Teleporting to tests/ now.');
  process.chdir('tests');
}

try {
  fs.unlinkSync('./db.json');
} catch (error) {
  if (error.code !== 'ENOENT') {
    console.error(error.stack);
    process.exit(1);
  }
}

try {
  fs.symlinkSync('../templates', './templates', 'dir');
} catch (error) {
  if (error.code !== 'EEXIST') {
    console.error(error.stack);
    process.exit(1);
  }
}

let tests = [];

tests.push({
  title: 'Janitor API self-tests',

  test: (port, callback) => {
    const db = require('../lib/db');
    // Tell our fake Janitor app that it runs on the fake host "example.com":
    db.get('hostnames', [ 'example.com' ]);
    // Disable sending any emails (for invites or signing in):
    db.get('mailer').block = true;
    // Disable Let's Encrypt HTTPS certificate generation and verification:
    db.get('security').forceHttp = true;
    // Disable any security policies that could get in the way of testing:
    db.get('security').forceInsecure = true;

    const boot = require('../lib/boot');
    const docker = require('../lib/docker');
    const hosts = require('../lib/hosts');
    const machines = require('../lib/machines');
    const users = require('../lib/users');

    // Fake several Docker methods for testing.
    // TODO Maybe use a real Docker Remote API server (or a full mock) for more
    // realistic tests?
    docker.pullImage = function (parameters, callback) {
      const readable = new stream.Readable();
      readable.push('ok');
      readable.push(null); // End the stream.
      callback(null, readable);
    };
    docker.inspectImage = function (parameters, callback) {
      callback(null, { Created: 1500000000000 });
    };
    docker.tagImage = function (parameters, callback) { callback(); };
    docker.runContainer = function (parameters, callback) {
      callback(null, { id: 'abcdef0123456789' }, '');
    };
    docker.copyIntoContainer = docker.execInContainer =
      function (parameters, callback) { callback(); };
    docker.listChangedFilesInContainer = function (parameters, callback) {
      callback(null, [
        { Path: '/tmp', Kind: 0 },
        { Path: '/tmp/test', Kind: 1 }
      ]);
    };
    docker.version = function (parameters, callback) {
      callback(null, { Version: '17.06.0-ce' });
    };

    function registerTestUser (next) {
      // Grant administrative privileges to the fake email "admin@example.com".
      db.get('admins')['admin@example.com'] = true;
      // Create the user "admin@example.com" by "sending" them an invite email.
      users.sendInviteEmail('admin@example.com', error => {
        if (error) {
          callback(error);
          return;
        }
        next();
      });
    }

    function createTestHost (next) {
      hosts.create('example.com', {}, (error, host) => {
        if (error) {
          callback(error);
          return;
        }
        next();
      });
    }

    function createTestProject (next) {
      machines.setProject({
        'id': 'test-project',
        '/name': 'Test Project',
        '/docker/host': 'example.com',
        '/docker/image': 'image:latest',
      });
      next();
    }

    function createTestContainer (next) {
      const user = db.get('users')['admin@example.com'];
      // Create a new user machine for the project "test-project".
      machines.spawn(user, 'test-project', error => {
        if (error) {
          callback(error);
          return;
        }
        next();
      });
    }

    boot.executeInParallel([
      boot.forwardHttp,
      boot.ensureDockerTlsCertificates,
      registerTestUser,
      createTestHost,
      createTestProject,
    ], () => {
      createTestContainer(() => {
        const camp = require('camp');
        const app = camp.start({
          documentRoot: process.cwd() + '/../static',
          port: port
        });

        // Authenticate test requests with a server middleware.
        const sessions = require('../lib/sessions');
        app.handle((request, response, next) => {
          sessions.get(request, (error, session, token) => {
            if (error || !session || !session.id) {
              console.error('[fail] session:', session, error);
              response.statusCode = 500; // Internal Server Error
              response.end();
              return;
            }
            request.session = session;
            if (!('client_secret' in request.query)) {
              request.user = db.get('users')['admin@example.com'];
            }
            next();
          });
        });

        // Mount the Janitor API.
        const api = require('../api/');
        selfapi(app, '/api', api);

        // Test the API against its own examples.
        api.test('http://localhost:' + port, (error, results) => {
          if (error) {
            callback(error);
            return;
          }

          if (results.failed.length > 0) {
            var total = results.passed.length + results.failed.length;
            callback(results.passed.length + '/' + total + ' API test' +
              (total === 1 ? '' : 's') + ' passed. Failed tests: ' +
              jsonStringifyWithFunctions(results.failed));
            return;
          }

          callback();
        });
      });
    });
  }
});

tests.push({
  title: 'Janitor persistent events',

  test: (port, callback) => {
    const events = require('../lib/events');

    // Expect to receive a TestEvent at a specified time (approximately).
    let received = false;
    const startTime = Date.now();
    const tooEarlyDelta = 1000 * 2; // Not before 2 seconds.
    const expectedDelta = 1000 * 5; // In about 5 seconds.
    const tooLateDelta = 1000 * 8; // Not after 8 seconds.
    const expectedTime = startTime + expectedDelta;

    // Fail the test if the TestEvent isn't received in time.
    let tooLate = false;
    setTimeout(() => {
      tooLate = true;
      if (!received) {
        const timeDelta = Date.now() - expectedTime;
        const delta = 'T' + (timeDelta < 0 ? '' : '+') + timeDelta + 'ms';
        callback(new Error('Did not receive TestEvent in time at ' + delta));
        return;
      }
    }, tooLateDelta);

    events.on('TestEvent', payload => {
      const timeDelta = Date.now() - expectedTime;
      const delta = 'T' + (timeDelta < 0 ? '' : '+') + timeDelta + 'ms';
      if (received) {
        console.error(new Error('Received duplicate TestEvent at ' + delta));
        return;
      }
      received = true;
      if (tooLate) {
        console.error(new Error('Received TestEvent too late at ' + delta));
        return;
      }
      if (timeDelta <= tooEarlyDelta - expectedDelta) {
        callback(new Error('Received TestEvent too early at ' + delta));
        return;
      }
      if (!(payload instanceof Object) || payload.expected !== 'value') {
        callback(new Error('Expected payload {"expected":"value"} but got ' +
          JSON.stringify(payload)));
        return;
      }
      console.log('[ok] Received TestEvent at ' + delta);
      callback();
    });

    // Request a TestEvent to be emitted at the specified time.
    events.emitAtTime('TestEvent', expectedTime, { expected: 'value' });
  }
});

/*
tests.push({
  title: 'Docker host joining the cluster',

  test: (port, callback) => {
    // TODO Start app (`node app` or similar)
    // TODO Start cluster host (`node join` or similar, on different ports)
    // TODO Verify that cluster registration works
    // TODO verify that
    callback(new Error('Not implemented yet'));
  }
});
*/

/**
 * To add a new test, simply copy-paste and fill in the following code block:

tests.push({
  title: '',
  test: (port, callback) => {
    // test some things
    // callback(error);
  }
});

*/

function jsonStringifyWithFunctions (value) {
  function replacer (key, value) {
    if (typeof value === 'function') {
      // Stringify this function, and slightly minify it.
      value = String(value).replace(/\s+/g, ' ');
    }
    return value;
  }
  return JSON.stringify(value, replacer, 2);
}

let nextPort = 9000;
function getPort (callback) {
  const port = nextPort++;
  const server = net.createServer();
  server.listen(port, (error) => {
    server.once('close', () => callback(port));
    server.close();
  });
  server.on('error', error => getPort(callback));
}

let unfinishedTests = tests.length;
function reportTest (test, error) {
  if (error) {
    process.exitCode = 1;
    console.error('[fail]', test.title);
    console.error(...(error.stack ? [ error.stack ] : [ 'Error:', error ]));
  } else {
    console.log('[ok]', test.title);
  }
  unfinishedTests--;
  if (unfinishedTests === 0) {
    process.exit();
  }
}

function runTest (test) {
  getPort(port => {
    try {
      test.test(port, error => reportTest(test, error));
    } catch (error) {
      reportTest(test, error);
    }
  });
}

while (tests.length > 0) {
  // Randomly take a test out of the tests array, and run it.
  const test = tests.splice(Math.floor(Math.random() * tests.length), 1)[0];
  runTest(test);
}
