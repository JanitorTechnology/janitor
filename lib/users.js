// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const certificates = require('./certificates');
const configurations = require('./configurations');
const db = require('./db');
const github = require('./github');
const hosts = require('./hosts');
const log = require('./log');
const metrics = require('./metrics');
const sessions = require('./sessions');

const hostname = db.get('hostname', 'localhost');
const security = db.get('security');
const baseUrl = (security.forceHttp ? 'http' : 'https') + '://' + hostname;

// Get a user for the current session.
exports.get = function (request, callback) {
  sessions.get(request, (error, session, token) => {
    if (error) {
      log('[fail] session', error);
      callback(null, session);
      return;
    }

    if (session.emailVerified()) {
      // The user is properly logged in.
      callback(getOrCreateUser(session.email), session);
      return;
    }

    const { key } = request.query;
    if (!key) {
      callback(null, session);
      return;
    }

    // We have a login key, let's see if it verifies the user's email.
    sessions.verifyEmail(token, key, (error, email) => {
      if (error || !email) {
        // No luck this time.
        log('email not verified', error);
        callback(null, session);
        return;
      }

      log(email, 'verified');
      callback(getOrCreateUser(email), session);
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

// Find the OAuth2 access scope and authorizing user for a request.
exports.getOAuth2ScopeWithUser = function (request) {
  const authenticatedScope = hosts.getOAuth2Scope(request);
  if (!authenticatedScope) {
    return null;
  }

  const { email, hostname, scopes } = authenticatedScope;
  const user = getOrCreateUser(email);
  return { hostname, scopes, user };
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

// Refresh a user's GitHub account details using an OAuth2 access token.
exports.refreshGitHubAccount = function (user, accessToken, refreshToken) {
  github.getUserProfile(accessToken, (error, profile) => {
    if (error) {
      log('[fail] could not get github username', error);
      return;
    }

    const { login: username, name } = profile;
    user.keys.github.username = username;
    user.keys.github.accessToken = accessToken;
    user.keys.github.refreshToken = refreshToken;
    user.profile.name = user.profile.name || name;

    db.save();

    github.getSSHPublicKeys(username, (error, sshPublicKeys) => {
      if (error) {
        log('[fail] could not get github public keys', error);
        return;
      }

      user.keys.github.authorizedKeys = sshPublicKeys;
      db.save();
    });
  });
};

// Forget a user's GitHub account details, including any access tokens.
exports.destroyGitHubAccount = function (user) {
  user.keys.github = {
    username: '',
    accessToken: '',
    refreshToken: '',
    authorizedKeys: []
  };
  db.save();
};

// Forget a user's Cloud9 account details.
exports.destroyCloud9Account = function (user) {
  user.keys.cloud9 = '';
  user.keys.cloud9user = '';
  db.save();
};

// Send a single-use login link to the user's email address.
exports.sendLoginEmail = function (email, request, callback) {
  sessions.get(request, (error, session, token) => {
    if (error) {
      log('[fail] could not send login email', error);
    }

    // Alpha version is invite-only.
    if (!(email in db.get('users')) && !exports.isAdmin({ email })) {
      // Add unknown emails to the waitlist.
      const waitlist = db.get('waitlist');
      if (!(email in waitlist)) {
        waitlist[email] = Date.now();
        db.save();
      }

      return callback(new Error('Signing in currently requires an invitation'));
    }

    // Login email template.
    const template = {
      subject () {
        return 'Janitor Sign-in link';
      },
      htmlMessage (key) {
        const url = baseUrl + '/?key=' + encodeURIComponent(key);

        if (security.forceInsecure) {
          log('[warning] sign-in link for ' + email + ':', url);
        }

        return '<p>Hello,</p>\n' +
        '<p>To sign in to the Janitor, please click ' +
          '<a href="' + url + '">here</a>.</p>\n' +
        '<p>This link will only work once, but you can get as many links as ' +
          'you want.</p>\n' +
        '<p>Thanks!<br>\nThe Janitor</p>\n';
      },
      textMessage (key) {
        const url = baseUrl + '/?key=' + encodeURIComponent(key);
        return 'Hello,\n\n' +
        'To sign in to the Janitor, please visit the following URL:\n\n' +
          url + '\n\n' +
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
    if (error) {
      log('[fail] could not create the session', error);
    }

    // Invite email template.
    const template = {
      subject () {
        return 'Janitor Invite';
      },
      htmlMessage (key) {
        const url = baseUrl + '/settings/?key=' + encodeURIComponent(key);
        return '<p>You are invited to join the Alpha of the Janitor.</p>\n' +
        '<p>To activate your free and unlimited account, please follow the ' +
          'steps below:\n<ol>' +
        '<li>Make sure you have a Cloud9 account (' +
          '<a href="https://c9.io/signup">click here</a> to create one for ' +
          'free)</li>\n' +
        '<li><a href="https://c9.io/account/ssh">Click here</a> to get your ' +
          'Cloud9 SSH public key</li>\n' +
        '<li><a href="' + url + '">Click here</a> to access your Janitor ' +
          'account, then add your Cloud9 username and your Cloud9 key</li>' +
          '</ol></p>\n' +
        '<p>With that, you will be able to clone and edit all the supported ' +
          'projects, as often and for as long as you like.</p>\n' +
        '<p>Happy hacking!<br>\nThe Janitor</p>\n';
      },
      textMessage (key) {
        const url = baseUrl + '/settings/?key=' + encodeURIComponent(key);
        return 'You are invited to join the Alpha of the Janitor.\n\n' +
        'To activate your free and unlimited account, please follow the ' +
          'steps below:\n\n' +
        '1. Make sure you have a Cloud9 account. You can create one for free ' +
          'by visiting:\n' +
          'https://c9.io/signup\n\n' +
        '2. Get your Cloud9 SSH public key by visiting:\n' +
          'https://c9.io/account/ssh\n\n' +
        '3. Access your Janitor account, then add your Cloud9 username ' +
          'and your Cloud9 key:\n' + url + '\n\n' +
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
      const user = getOrCreateUser(email);

      // Remove this email from the waitlist.
      const waitlist = db.get('waitlist');
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
function getOrCreateUser (email) {
  const users = db.get('users');
  let user = users[email];

  if (!user) {
    user = {
      email: email,
      profile: {
        name: '',
      },
      configurations: {
        '.gitconfig': '',
        '.gitignore': '',
        '.hgrc': '',
      },
      keys: {
        cloud9: '',
        cloud9user: '',
        github: {
          username: '',
          accessToken: '',
          refreshToken: '',
          authorizedKeys: []
        },
        ssh: {
          fingerprint: '',
          privateKey: '',
          publicKey: '',
        }
      },
      machines: {},
      notifications: {
        enabled: false,
        feed: [],
      },
      data: {},
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
      publicKey: '',
    };
    exports.resetSSHKeyPair(user);
  }

  // Temporary migration code: Previous users didn't have a profile.
  if (!user.profile) {
    user.profile = {
      name: ''
    };
    delete user.name;
  }

  for (const projectId in user.machines) {
    for (const machine of user.machines[projectId]) {
      // Temporary migration code: Previous users didn't have machine
      // properties.
      if (!machine.properties) {
        machine.properties = { name: machine.name };
        delete machine.name;
      }

      // Temporary migration code: Previous machines didn't keep keep track of
      // their project.
      if (!machine.project) {
        machine.project = projectId;
      }
    }
  }

  // Temporary migration code: Previous users didn't have GitHub credentials.
  if (!('github' in user.keys)) {
    exports.destroyGitHubAccount(user);
  }

  // Temporary migration code: Previous users didn't have configuration files.
  if (!user.configurations) {
    user.configurations = {};
  }
  Object.keys(configurations.defaults).forEach(file => {
    if (!user.configurations[file]) {
      configurations.resetToDefault(user, file, error => {
        if (error) {
          log('[fail] default user configuration:', file, error);
        }
      });
    }
  });

  // Temporary migration code: Previous users didn't have notification settings.
  if (!user.notifications) {
    user.notifications = {
      enabled: false,
      feed: [],
    };
  }

  return user;
}
