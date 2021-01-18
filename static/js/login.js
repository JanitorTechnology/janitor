// Copyright © 2015 Team Janitor. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

// Email-login form.

ajaxForm('#login-form', 'login', function (form, data) {
  let status = 'error';
  let message = data.message;

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
