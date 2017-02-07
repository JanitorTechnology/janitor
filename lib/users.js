// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

let certificates = require('./certificates');
let db = require('./db');
let hosts = require('./hosts');
let log = require('./log');
let metrics = require('./metrics');
let sessions = require('./sessions');

let hostname = db.get('hostname', 'localhost');

// Get a user for the current session.
exports.get = function (request, callback) {
  sessions.get(request, (error, session, token) => {
    if (error) {
      log('[fail] session', error);
      callback(null);
      return;
    }

    if (session.emailVerified()) {
      // The user is properly logged in.
      callback(getUser(session.email));
      return;
    }

    let { key } = request.query;
    if (!key) {
      callback(null);
      return;
    }

    // We have a login key, let's see if it verifies the user's email.
    sessions.verifyEmail(token, key, (error, email) => {
      if (error || !email) {
        // No luck this time.
        log('email not verified', error);
        callback(null);
        return;
      }
      log(email, 'verified');
      callback(getUser(email));
    });
  });
};

// Destroy the current session.
exports.logout = function (request, callback) {
  sessions.destroy(request, error => {
    callback(error);
  });
};

// Check if a given user has admin privileges.
exports.isAdmin = function (user) {
  if (user && user.email && (user.email in db.get('admins'))) {
    return true;
  }

  return false;
};

// Find the user that authorized a given OAuth2 request, and its access scope.
exports.getOAuth2Access = function (request) {
  let authorization = hosts.authenticateOAuth2Request(request);
  if (authorization) {
    let { email, hostname, scope } = authorization;
    let user = getUser(email);
    return { hostname, scope, user };
  }

  return null;
};

// Reset a user's dedicated Janitor SSH key pair.
exports.resetSSHKeyPair = function (user) {
  certificates.createSSHKeyPair((error, keypair) => {
    if (error) {
      log('error while creating ssh keypair', error);
      return;
    }

    user.keys.ssh.fingerprint = keypair.fingerprint;
    user.keys.ssh.privateKey = keypair.privateKey;
    user.keys.ssh.publicKey = keypair.publicKey;
    db.save();
  });
};

// Send a single-use login link to the user's email address.
exports.sendLoginEmail = function (email, request, callback) {
  sessions.get(request, (error, session, token) => {
    // Alpha version is invite-only.
    if (!(email in db.get('users'))) {
      // Add unknown emails to the waitlist.
      let waitlist = db.get('waitlist');
      if (!(email in waitlist)) {
        waitlist[email] = Date.now();
        db.save();
      }

      return callback(new Error('Signing in currently requires an invitation'));
    }

    // Login email template.
    let template = {
      subject () {
        return 'Janitor Sign-in link';
      },
      htmlMessage (key) {
        return '<p>Hello,</p>\n' +
        '<p>To sign in to the Janitor, please click ' +
        '<a href="https://' + hostname + '/?key=' + key + '">here</a>.</p>\n' +
        '<p>This link will only work once, but you can get as many links as ' +
          'you want.</p>\n' +
        '<p>Thanks!<br>\nThe Janitor</p>\n';
      },
      textMessage (key) {
        return 'Hello,\n\n' +
        'To sign in to the Janitor, please visit the following URL:\n\n' +
        'https://' + hostname + '/?key=' + key + '\n\n' +
        'This link will only work once, but you can get as many links as ' +
          'you want.\n\n' +
        'Thanks!\nThe Janitor\n';
      }
    };
    sessions.sendVerificationEmail(email, token, template, callback);
  });
};

// Invite someone to join the Alpha version.
exports.sendInviteEmail = function (email, callback) {
  // Generate a dummy token for that invite.
  sessions.create((error, token, session) => {
    // Invite email template.
    let template = {
      subject () {
        return 'Janitor Invite';
      },
      htmlMessage (key) {
        return '<p>You are invited to join the Alpha of the Janitor.</p>\n' +
        '<p>To activate your free and unlimited account, please follow the ' +
          'steps below:\n<ol>' +
        '<li><a href="https://c9.io/signup">' +
          'Click here</a> to create a free Cloud9 account</li>\n' +
        '<li><a href="https://c9.io/account/ssh">Click here</a> to get your ' +
          'Cloud9 SSH public key</li>\n' +
        '<li><a href="https://' + hostname + '/settings/?key=' + key + '">' +
          'Click here</a> to access your Janitor account, then add ' +
          'your Cloud9 username and your Cloud9 key</li></ol></p>\n' +
        '<p>With that, you will be able to clone and edit all the supported ' +
          'projects, as often and for as long as you like.</p>\n' +
        '<p>Happy hacking!<br>\nThe Janitor</p>\n';
      },
      textMessage (key) {
        return 'You are invited to join the Alpha of the Janitor.\n\n' +
        'To activate your free and unlimited account, please follow the ' +
          'steps below:\n\n' +
        '1. Create a free Cloud9 account by visiting:\n' +
          'https://c9.io/signup\n\n' +
        '2. Get your Cloud9 SSH public key by visiting:\n' +
          'https://c9.io/account/ssh\n\n' +
        '3. Access your Janitor account, then add your Cloud9 username ' +
          'and your Cloud9 key:\n' +
          'https://' + hostname + '/settings/?key=' + key + '\n\n' +
        'With that, you will be able to clone and edit all the supported ' +
          'projects, as often and for as long as you like.\n\n' +
        'Happy hacking!\nThe Janitor\n';
      }
    };

    sessions.sendVerificationEmail(email, token, template, error => {
      if (error) {
        callback(error);
        return;
      }

      // Ensure we have a user for that email address.
      let user = getUser(email);

      // Remove this email from the waitlist.
      let waitlist = db.get('waitlist');
      if (email in waitlist) {
        // Remember when the user signed up, not when they were invited.
        metrics.set(user, 'joined', waitlist[email]);
        delete waitlist[email];
        db.save();
      }

      callback();
    });
  });
};

// Find an existing user, or create a new one.
function getUser (email) {
  let users = db.get('users');
  let user = users[email];

  if (!user) {
    user = {
      email: email,
      keys: {
        cloud9: '',
        cloud9user: '',
        ssh: {
          fingerprint: '',
          privateKey: '',
          publicKey: ''
        }
      },
      machines: {},
      data: {}
    };

    metrics.set(user, 'joined', Date.now());
    exports.resetSSHKeyPair(user);

    users[email] = user;
    db.save();
  }

  // Temporary migration code: Previous users didn't have an SSH key pair.
  if (!user.keys.ssh) {
    user.keys.ssh = {
      fingerprint: '',
      privateKey: '',
      publicKey: ''
    };
    exports.resetSSHKeyPair(user);
  }

  return user;
}
