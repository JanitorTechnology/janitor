// Copyright © 2015 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

/* global ajaxForm, updateFormStatus */

// Email-login form.

ajaxForm('#login-form', 'login', function (form, data) {
  var status = 'error';
  var message = data.message;

  switch (data.status) {
    case 'logged-in':
      status = 'success';
      message = 'Signing you in…';
      // TODO Redirect.
      break;
    case 'email-sent':
      status = 'success';
      message = 'You should receive an email shortly';
      break;
  }

  updateFormStatus(form, status, message);
});
