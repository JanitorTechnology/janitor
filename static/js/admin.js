// Copyright © 2015 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.


// Alpha version invite form.

ajaxForm('#invite-form', 'invite', function (form, data) {

  var status = 'error';
  var message = data.message;

  switch (data.status) {
    case 'already-invited':
      status = 'success';
      message = 'This person is already invited';
      form.elements.email.value = '';
      break;
    case 'invited':
      status = 'success';
      message = 'Invite sent!';
      form.elements.email.value = '';
      break;
  }

  updateFormStatus(form, status, message);

});


// New project form.

ajaxForm('#newproject-form', 'projectdb', function (form, data) {

  var status = 'error';
  var message = data.message;

  switch (data.status) {
    case 'success':
      status = 'success';
      message = 'Project added!';
      document.location.reload();
      break;
  }

  updateFormStatus(form, status, message);

});


// Project rebuild/update buttons.

Array.map(document.querySelectorAll('button[data-action]'), function (button) {

  button.addEventListener('click', Scout.send(function (query) {
    query.action = button.dataset.action;
    query.data = {
      project: button.dataset.project
    };
    query.resp = function (data) {
      document.location.reload();
    };
  }));

});
