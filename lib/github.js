// Copyright © 2017 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const db = require('./db');
const oauth2 = require('./oauth2');

load();

// Load our GitHub OAuth2 credentials.
function load () {
  const oauth2providers = db.get('oauth2providers');

  // Add a non-functional, empty GitHub OAuth2 provider by default.
  if (!oauth2providers.github) {
    oauth2providers.github = {
      id: '',
      secret: '',
      hostname: 'github.com',
      api: 'api.github.com',
    };
  }
}

// Associate non-persistent OAuth2 states to sessions.
const oauth2States = {};

// Generate a URL allowing users to authorize us as a GitHub OAuth2 application.
exports.getAuthorizationUrl = function (request, callback) {
  const { session } = request;
  if (!session || !session.id) {
    callback(new Error('Request has no associated session'));
    return;
  }

  // Generate a new OAuth2 state parameter for this authentication link.
  oauth2.generateStateParameter((error, state) => {
    if (error) {
      callback(error);
      return;
    }

    oauth2States[session.id] = state;
    const parameters = {
      provider: 'github',
      options: {
        scope: [ 'user:email' ],
        state,
      }
    };

    oauth2.getAuthorizationUrl(parameters, (error, authorizeUrl) => {
      callback(error, authorizeUrl);
    });
  });
};

// Exchange a GitHub OAuth2 authorization code against an access token.
exports.authenticate = function (request, callback) {
  const { session } = request;
  if (!session || !session.id) {
    callback(new Error('Request has no associated session'));
    return;
  }

  const { state } = request.query;
  const expectedState = oauth2States[session.id];
  if (!state || String(state) !== String(expectedState)) {
    callback(new Error('Bad state: Got ' + state + ' but expected ' +
      expectedState));
    return;
  }

  const { code } = request.query;
  const parameters = {
    provider: 'github',
    code,
    options: { state },
  };

  oauth2.getAccessToken(parameters, (error, accessToken, refreshToken) => {
    if (error) {
      callback(error);
      return;
    }

    delete oauth2States[session.id];
    callback(null, accessToken, refreshToken);
  });
};

// Perform an authenticated GitHub API request.
exports.request = function (method, path, data, accessToken, callback) {
  const parameters = {
    provider: 'github',
    accessToken,
    method,
    path,
    data,
    headers: {
      'Accept': 'application/vnd.github.v3+json'
    }
  };

  oauth2.request(parameters, (error, body, response) => {
    if (error) {
      callback(error);
      return;
    }

    const responseStatus = response.statusCode;
    if (responseStatus < 200 || responseStatus >= 300) {
      error = new Error('GitHub API response status: ' + responseStatus);
    }

    try {
      const data = JSON.parse(body);
      callback(error, data);
    } catch (err) {
      callback(error || err, body);
    }
  });
};

// Get the user's public profile information.
// A `profile` object may contain information like:
// {
//   "login": "octocat",
//   "name": "monalisa octocat",
//   "blog": "https://github.com/blog",
//   "location": "San Francisco",
//   "bio": "There once was...",
// }
// See: https://developer.github.com/v3/users/#get-the-authenticated-user
exports.getUserProfile = function (accessToken, callback) {
  exports.request('GET', '/user', null, accessToken, (error, profile) => {
    if (error) {
      callback(error);
      return;
    }

    callback(null, profile);
  });
};

// Get the user's verified email addresses.
exports.getVerifiedEmails = function (accessToken, callback) {
  exports.request('GET', '/user/emails', null, accessToken, (error, emails) => {
    if (error) {
      callback(error);
      return;
    }

    // Don't trust un-verified email addresses.
    const verifiedEmails = emails.filter(email => email.verified);
    callback(null, verifiedEmails);
  });
};

// Get the user's authorized SSH public keys (doesn't require an access token).
exports.getSSHPublicKeys = function (username, callback) {
  const url = '/users/' + username + '/keys';

  exports.request('GET', url, null, null, (error, sshPublicKeys) => {
    if (error) {
      callback(error);
      return;
    }

    callback(null, sshPublicKeys);
  });
};
