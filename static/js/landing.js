// Copyright © 2015 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.


// Alpha sign-up form.

ajaxForm('#signup-form', 'signup', function (form, data) {

  var status = 'error';
  var message = data.message;

  switch (data.status) {
    case 'added':
      status = 'success';
      message = 'Email saved!';
      break;
    case 'already-added':
      status = 'success';
      message = 'We already have this email';
      break;
  }

  updateFormStatus(form, status, message);

});
