// Copyright © 2015 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

/* global ajaxForm, updateFormStatus */

// Settings: Cloud9 username form.

ajaxForm('#cloud9user-form', 'key', function (form, data) {
  var status = 'error';
  var message = data.message;

  if (data.status === 'key-saved') {
    status = 'success';
  }

  updateFormStatus(form, status, message);
});

// Settings: Cloud9 SSH key form.

ajaxForm('#cloud9-form', 'key', function (form, data) {
  var status = 'error';
  var message = data.message;

  if (data.status === 'key-saved') {
    status = 'success';
  }

  updateFormStatus(form, status, message);
});
