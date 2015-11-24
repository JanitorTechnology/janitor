// Copyright © 2015 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.


// Account: Cloud9 SSH key form.

ajaxForm('#cloud9-form', 'key', function (form, data) {

  var status = 'error';
  var message = data.message;

  if (data.status === 'key-saved') {
    status = 'success';
  }

  updateFormStatus(form, status, message);

});
