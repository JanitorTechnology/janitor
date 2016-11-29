// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

let emaillogin = require('email-login');

let db = require('./db');

let login = new emaillogin({
  db: './tokens/',
  mailer: db.get('mailer')
});

// Create a new session with a unique token.
exports.create = function (callback) {
  login.login((error, token, session) => {
    if (error) {
      callback(error);
      return;
    }
    callback(null, token, session);
  });
};

// Find the session associated to the given request, or associate a new session.
exports.get = function (request, callback) {
  // Extract the session token from the cookies, if available.
  let cookies = request.headers.cookie || '';
  let cookie = cookies.split('; ').filter(cookie => {
    return cookie.startsWith('token=');
  })[0];
  let token = (cookie ? cookie.slice(6) : '');

  login.authenticate(token, (error, success, session) => {
    if (success) {
      callback(error, session, token);
      return;
    }

    // No current session, create a new one.
    exports.create((error, token, session) => {
      if (error) {
        callback(error);
        return;
      }
      if (request.cookies) {
        request.cookies.set('token', token, {
          expires: new Date('2038-01-19T03:14:07Z'),
          secure: true
        });
      }
      callback(null, session, token);
    });
  });
};

// Destroy the session associated to the given request.
exports.destroy = function (request, callback) {
  exports.get(request, (error, session, token) => {
    if (request.cookies) {
      // Destroy the cookie.
      request.cookies.set('token', '', {
        overwrite: true,
        secure: true
      });
    }
    // Destroy the session.
    login.logout(token, error => {
      callback(error);
    });
  });
};

// Send a challenge email to a given email address for verification.
exports.sendVerificationEmail = function (email, token, template, callback) {
  login.proveEmail({
    email: email,
    token: token,
    subject: template.subject,
    htmlMessage: template.htmlMessage,
    textMessage: template.textMessage
  }, error => {
    callback(error);
  });
};

// Attempt to verify an email address using the given login key.
exports.verifyEmail = function (token, key, callback) {
  login.confirmEmail(token, key, (error, token, session) => {
    if (error) {
      callback(error);
      return;
    }
    if (!session || !session.emailVerified()) {
      callback(new Error('Unverified email: ' + (session && session.email)));
      return;
    }
    callback(null, session.email);
  });
};
