// Copyright © 2016 Team Janitor. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const EmailLogin = require('email-login');

const db = require('./db');
const log = require('./log');

const login = new EmailLogin({
  db: './tokens/',
  mailer: db.get('mailer')
});
const useSecureCookies = !db.get('security').forceInsecure;

// Get the cookie name saved from a previous session if any.
const cookieNames = db.get('cookieNames');
if (!cookieNames.token) {
  // Generate a unique cookie name so that it doesn't clash when loading Janitor
  // inside a Janitor container (see #93).
  cookieNames.token = 'token-' + String(Date.now());
}

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
  const cookiePrefix = cookieNames.token + '=';
  const cookies = request.headers.cookie || '';
  const cookie = cookies.split('; ').filter(cookie => {
    return cookie.startsWith(cookiePrefix);
  })[0];
  const token = cookie ? cookie.slice(cookiePrefix.length) : '';

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
        request.cookies.set(cookieNames.token, token, {
          expires: new Date('2038-01-19T03:14:07Z'),
          secure: useSecureCookies
        });
      }

      callback(null, session, token);
    });
  });
};

// Destroy the session associated to the given request.
exports.destroy = function (request, callback) {
  exports.get(request, (error, session, token) => {
    if (error) {
      log('[fail] could not destroy the session', error);
    }

    if (request.cookies) {
      // Destroy the cookie.
      request.cookies.set(cookieNames.token, '', {
        overwrite: true,
        secure: useSecureCookies
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
