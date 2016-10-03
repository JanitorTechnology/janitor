// Copyright © 2015 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

var emaillogin = require('email-login');

var certificates = require('./certificates');
var db = require('./db');
var log = require('./log');
var metrics = require('./metrics');

var login = new emaillogin({
  db: './tokens/',
  mailer: db.get('mailer')
});


// Get a user for the current session.

function get (request, callback) {

  getSession(request, (error, session, token) => {

    var parameters = request.query;

    if (session.emailVerified()) {

      // The user is properly logged in.
      callback(error, getUser(session.email));
      return;

    } else if (parameters.key) {

      // We have a login key, let's see if it confirms the user's email.
      login.confirmEmail(token, parameters.key, (error, token, session) => {

        if (session && session.emailVerified()) {
          log(session.email, 'confirmed');
          callback(error, getUser(session.email));
          return;
        }

        // No luck this time.
        log('email not confirmed');
        callback(error, null);
        return;

      });

    } else {

      callback(error, null);
      return;

    }

  });

}

exports.get = get;


// Destroy the current session.

function logout (request, callback) {

  getSession(request, (error, session, token) => {

    // Destroy the cookie.
    request.cookies.set('token', '', {
      overwrite: true,
      secure: true
    });

    // Destroy the session.
    login.logout(token, (error) => {
      callback(error);
    });

  });

}

exports.logout = logout;


// Check if a given user has admin privileges.

function isAdmin (user) {

  if (user && user.email && (user.email in db.get('admins'))) {
    return true;
  }

  return false;

}

exports.isAdmin = isAdmin;


// Reset a user's dedicated Janitor SSH key pair.

function resetSSHKeyPair (user) {

  certificates.createSSHKeyPair((error, keypair) => {

    if (error) {
      log('error while creating ssh keypair', String(error));
      return;
    }

    user.keys.ssh.fingerprint = keypair.fingerprint;
    user.keys.ssh.privateKey = keypair.privateKey;
    user.keys.ssh.publicKey = keypair.publicKey;
    db.save();

  });

}

exports.resetSSHKeyPair = resetSSHKeyPair;


// Send a single-use login link to the user's email address.

function sendLoginEmail (email, request, callback) {

  getSession(request, (error, session, token) => {

    // Alpha version is invite-only.
    if (!(email in db.get('users'))) {

      // Add unknown emails to the waitlist.
      var waitlist = db.get('waitlist');
      if (!(email in waitlist)) {
        waitlist[email] = Date.now();
        db.save();
      }

      return callback(new Error('Signing in currently requires an invitation'));

    }

    // Login email template.
    var hostname = db.get('hostname', 'localhost');
    var template = {
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

    sendEmail(email, token, template, callback);

  });

}

exports.sendLoginEmail = sendLoginEmail;


// Invite someone to join the Alpha version.

function sendInviteEmail (email, callback) {

  // Generate a dummy token for that invite.
  login.login((error, token, session) => {

    // Invite email template.
    var hostname = db.get('hostname', 'localhost');
    var template = {
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

    sendEmail(email, token, template, (error) => {
      if (!error) {
        // Ensure we have a user for that email address.
        var user = getUser(email);

        // Remove this email from the waitlist.
        var waitlist = db.get('waitlist');
        if (email in waitlist) {
          // Remember when the user signed up, not when they were invited.
          metrics.set(user, 'joined', waitlist[email]);
          delete waitlist[email];
          db.save();
        }
      }
      callback(error);
    });

  });

}

exports.sendInviteEmail = sendInviteEmail;


// Send a challenge email to a given address for verification.

function sendEmail (email, token, template, callback) {

  login.proveEmail({
    email: email,
    token: token,
    subject: template.subject,
    htmlMessage: template.htmlMessage,
    textMessage: template.textMessage
  }, (error) => {
    callback(error);
  });

} // Don't export `sendEmail`.


// Find the current session, or create a new one.

function getSession (request, callback) {

  // Extract the session token from the cookies, if available.
  var cookies = request.headers.cookie || '';
  var cookie = cookies.split('; ').filter((cookie) => {
    return cookie.startsWith('token=');
  })[0];
  var token = (cookie ? cookie.slice(6) : '');

  login.authenticate(token, (error, success, session) => {

    if (success) {
      callback(error, session, token);
      return;
    }

    // No current session, create a new one.
    login.login((error, token, session) => {
      if (request.cookies) {
        request.cookies.set('token', token, {
          expires: new Date('2038-01-19T03:14:07Z'),
          secure: true
        });
      }
      callback(error, session, token);
      return;
    });

  });

} // Don't export `getSession`.


// Find an existing user, or create a new one.

function getUser (email) {

  var users = db.get('users');
  var user = users[email];

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
    resetSSHKeyPair(user);

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
    resetSSHKeyPair(user);
  }

  return user;

} // Don't export `getUser`.
