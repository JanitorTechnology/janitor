// Copyright © 2017 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

'use strict';

const { Camp } = require('camp');
const selfapi = require('selfapi');
const stream = require('stream');
const { promisify } = require('util');

describe('Janitor API self-tests', () => {
  jest.mock('../lib/boot');
  jest.mock('../lib/db');
  jest.mock('../lib/docker');

  const db = require('../lib/db');
  db.__setData({
    // Tell our fake Janitor app that it runs on the fake host "example.com"
    hostname: 'example.com',
    // Disable sending any emails (for invites or signing in)
    mailer: {
      block: true
    },
    security: {
      // Disable Let's Encrypt HTTPS certificate generation and verification
      forceHttp: true,
      // Disable any security policies that could get in the way of testing
      forceInsecure: true
    },
    tokens: 'test/tokens'
  });

  const boot = require('../lib/boot');
  boot.ensureDockerTlsCertificates.mockResolvedValue();

  const docker = require('../lib/docker');
  const hosts = require('../lib/hosts');
  const machines = require('../lib/machines');
  const users = require('../lib/users');

  // Fake several Docker methods for testing.
  // TODO Maybe use a real Docker Remote API server (or a full mock) for more
  // realistic tests?
  docker.pullImage.mockImplementation(parameters => {
    const readable = new stream.Readable();
    readable.push('ok');
    readable.push(null); // End the stream.
    return Promise.resolve(readable);
  });
  docker.inspectImage.mockResolvedValue({ Created: 1500000000000 });
  docker.tagImage.mockResolvedValue();
  docker.runContainer.mockResolvedValue({ container: { id: 'abcdef0123456789' }, logs: '' });
  docker.copyIntoContainer.mockResolvedValue();
  docker.execInContainer.mockResolvedValue();
  docker.listChangedFilesInContainer.mockResolvedValue([
    { Path: '/tmp', Kind: 0 },
    { Path: '/tmp/test', Kind: 1 }
  ]);
  docker.version.mockResolvedValue({ Version: '17.06.0-ce' });

  const api = require('../api/');

  const app = new Camp({
    documentRoot: 'static'
  });

  beforeAll(async () => {
    function registerTestUser () {
      // Grant administrative privileges to the fake email "admin@example.com".
      db.get('admins')['admin@example.com'] = true;
      // Create the user "admin@example.com" by "sending" them an invite email.
      return promisify(users.sendInviteEmail)('admin@example.com');
    }

    function createTestHost () {
      return promisify(hosts.create)('example.com', {});
    }

    function createTestProject () {
      machines.setProject({
        'id': 'test-project',
        '/name': 'Test Project',
        '/docker/host': 'example.com',
        '/docker/image': 'image:latest',
      });
    }

    function createTestContainer () {
      const user = db.get('users')['admin@example.com'];
      // Create a new user machine for the project "test-project".
      return machines.spawn(user, 'test-project');
    }

    await Promise.all([
      registerTestUser(),
      createTestHost(),
      createTestProject(),
    ]);
    await createTestContainer();

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
    selfapi(app, '/api', api);

    await promisify(app.listen).call(app, 0, '127.0.0.1');
  });

  afterAll(() => {
    return promisify(app.close).call(app);
  });

  it('follows API examples', async () => {
    const { passed, failed } = await promisify(api.test).call(api, `http://127.0.0.1:${app.address().port}`);
    console.info(`${passed.length} passed, ${failed.length} failed`);
    expect(failed).toHaveLength(0);
  });
});
