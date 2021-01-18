// Copyright © 2016 Team Janitor. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const certificates = require('./certificates');
const configurations = require('./configurations');
const db = require('./db');
const github = require('./github');
const hosts = require('./hosts');
const log = require('./log');
const metrics = require('./metrics');
const sessions = require('./sessions');

const hostnames = db.get('hostnames', ['localhost']);
const security = db.get('security');
const baseUrl = (security.forceHttp ? 'http' : 'https') + '://' + hostnames[0] +
  (hostnames[0] === 'localhost' ? ':' + db.get('ports').https : '');

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
  if (user && user._primaryEmail && (user._primaryEmail in db.get('admins'))) {
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
  certificates.createSSHKeyPair().then(keypair => {
    user.keys.ssh.fingerprint = keypair.fingerprint;
    user.keys.ssh.privateKey = keypair.privateKey;
    user.keys.ssh.publicKey = keypair.publicKey;
    db.save();
  }).catch(error => {
    log('error while creating ssh keypair', error);
  });
};

// Refresh a user's GitHub account details using an OAuth2 access token.
exports.refreshGitHubAccount = async function (user, accessToken, refreshToken) {
  const { login: username, name } = await github.getUserProfile(accessToken);
  user.keys.github.username = username;
  user.keys.github.accessToken = accessToken;
  user.keys.github.refreshToken = refreshToken;
  user.profile.name = user.profile.name || name;

  db.save();

  // Import SSH public keys (no need to wait for this to finish).
  github.getSSHPublicKeys(username).then(sshPublicKeys => {
    user.keys.github.authorizedKeys = sshPublicKeys;
    db.save();
  }).catch(error => {
    log('[fail] could not get github public keys', error);
  });

  // Import verified email addresses (no need to wait for this to finish).
  github.getVerifiedEmails(accessToken).then(verifiedEmails => {
    user.keys.github.emails = verifiedEmails;
    db.save();
  }).catch(error => {
    log('[fail] could not get github verified emails', error);
  });
};

// Forget a user's GitHub account details, including any access tokens.
exports.destroyGitHubAccount = function (user) {
  user.keys.github = {
    username: '',
    accessToken: '',
    refreshToken: '',
    authorizedKeys: [],
    emails: [],
  };
  db.save();
};

// Forget a user's Cloud9 account details.
exports.destroyCloud9Account = function (user) {
  user.keys.cloud9 = '';
  db.save();
};

// Send a single-use login link to the user's email address.
exports.sendLoginEmail = function (email, request, callback) {
  sessions.get(request, (error, session, token) => {
    if (error) {
      log('[fail] could not send login email', error);
    }

    // Alpha version is invite-only.
    if (!(email in db.get('users')) && !exports.isAdmin({ _primaryEmail: email })) {
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
          '<p>To sign in to Janitor, please click ' +
            '<a href="' + url + '">here</a>.</p>\n' +
          '<p>This link will only work once, but you can get as many links ' +
            'as you want.</p>\n' +
          '<p>Thanks!</p>\n';
      },
      textMessage (key) {
        const url = baseUrl + '/?key=' + encodeURIComponent(key);
        return 'Hello,\n\n' +
          'To sign in to Janitor, please visit the following URL:\n\n' +
            url + '\n\n' +
          'This link will only work once, but you can get as many links ' +
            'as you want.\n\n' +
          'Thanks!\n';
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
        const url = baseUrl + '/projects/?key=' + encodeURIComponent(key);
        return '<p>You are invited to try the Janitor Alpha.</p>\n' +
          '<p>To activate your free and unlimited account, please click ' +
            '<a href="' + url + '">here</a>.</p>\n' +
          '<p>Happy hacking!</p>\n';
      },
      textMessage (key) {
        const url = baseUrl + '/projects/?key=' + encodeURIComponent(key);
        return 'You are invited to try the Janitor Alpha.\n\n' +
          'To activate your free and unlimited account, please visit the ' +
            'following URL:\n\n' + url + '\n\n' +
          'Happy hacking!\n';
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
      emails: [email],
      profile: {
        name: '',
      },
      configurations: {},
      keys: {
        cloud9: '',
        github: {
          username: '',
          accessToken: '',
          refreshToken: '',
          authorizedKeys: [],
          emails: [],
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

  // Temporary migration code: Previous users didn't have multilple emails.
  if (!Array.isArray(user.emails)) {
    user.emails = [email];
    delete user.email;
  }

  // Add a hidden internal getter for the user's primary email address.
  if (!Object.prototype.hasOwnProperty.call(user, '_primaryEmail')) {
    Object.defineProperty(user, '_primaryEmail', {
      get () {
        return this.emails[0];
      }
    });
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

  // Temporary migration code: Previous users didn't have GitHub emails.
  if (!Array.isArray(user.keys.github.emails)) {
    user.keys.github.emails = [];
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
