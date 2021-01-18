// Copyright © 2017 Team Janitor. All rights reserved.
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
exports.getAuthorizationUrl = async function (request) {
  const { session } = request;
  if (!session || !session.id) {
    throw new Error('Request has no associated session');
  }

  // Generate a new OAuth2 state parameter for this authentication link.
  const state = await oauth2.generateStateParameter();
  oauth2States[session.id] = state;

  const parameters = {
    provider: 'github',
    options: {
      scope: ['public_repo', 'user:email'],
      state,
    }
  };

  return oauth2.getAuthorizationUrl(parameters);
};

// Exchange a GitHub OAuth2 authorization code against an access token.
exports.authenticate = async function (request) {
  const { session } = request;
  if (!session || !session.id) {
    throw new Error('Request has no associated session');
  }

  const { state } = request.query;
  const expectedState = oauth2States[session.id];
  if (!state || String(state) !== String(expectedState)) {
    throw new Error('Bad state: Got ' + state + ' but expected ' +
      expectedState);
  }

  const { code } = request.query;
  const parameters = {
    provider: 'github',
    code,
    options: { state },
  };

  const { accessToken, refreshToken } = await oauth2.getAccessToken(parameters);
  delete oauth2States[session.id];

  return { accessToken, refreshToken };
};

// Perform an authenticated GitHub API request.
async function fetchGitHubAPI (method, path, data, accessToken) {
  const parameters = {
    provider: 'github',
    accessToken,
    method,
    path,
    data,
    headers: {
      Accept: 'application/vnd.github.v3+json'
    }
  };

  const { body, response } = await oauth2.request(parameters);

  const responseStatus = response.statusCode;
  if (responseStatus < 200 || responseStatus >= 300) {
    throw new Error('GitHub API response status: ' + responseStatus + '\n' +
      body);
  }

  try {
    const data = JSON.parse(body);
    return data;
  } catch (error) {
    throw new Error('Could not parse GitHub API response:\n' + body);
  }
}

// Get the user's public profile information.
// A profile object may contain information like:
// {
//   "login": "octocat",
//   "name": "monalisa octocat",
//   "blog": "https://github.com/blog",
//   "location": "San Francisco",
//   "bio": "There once was...",
// }
// See: https://developer.github.com/v3/users/#get-the-authenticated-user
exports.getUserProfile = function (accessToken) {
  return fetchGitHubAPI('GET', '/user', null, accessToken);
};

// Get the user's verified email addresses.
exports.getVerifiedEmails = async function (accessToken) {
  const emails = await fetchGitHubAPI('GET', '/user/emails', null, accessToken);

  // Don't trust un-verified email addresses.
  const verifiedEmails = emails
    .filter(email => email.verified)
    .map(email => email.email);
  return verifiedEmails;
};

// Get the user's authorized SSH public keys (doesn't require an access token).
exports.getSSHPublicKeys = function (username) {
  return fetchGitHubAPI('GET', `/users/${username}/keys`, null, null);
};
