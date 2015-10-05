

// Alpha sign-up form.

emailForm('#signup-form', 'signup', function (data) {

  var form = document.querySelector('#signup-form');
  var message = data.message;
  var status = 'error';

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


// Email-login form.

emailForm('#login-form', 'login', function (data) {

  var form = document.querySelector('#login-form');
  var message = data.message;
  var status = 'error';

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


// Update the visual feedback of an ajax form's status.

function updateFormStatus (form, status, message) {

  var submit = form.querySelector('input[type=submit]');

  form.classList.remove('has-success', 'has-error');

  switch (status) {
    case 'success':
      form.classList.add('has-success');
      break;
    case 'error':
      form.classList.add('has-error');
      submit.classList.remove('disabled');
      break;
    default:
      submit.classList.remove('disabled');
  }

  if (message) {
    var feedback = form.querySelector('.form-control-feedback');
    feedback.dataset.message = message;
    feedback.focus();
  }

}


// Set-up an ajax form to send an email address.

function emailForm (selector, action, callback) {

  var form = document.querySelector(selector);

  if (!form) {
    return;
  }

  var email = form.querySelector('input[type=email]');
  var submit = form.querySelector('input[type=submit]');

  function resetFormStatus () {
    updateFormStatus(form);
  }

  email.addEventListener('change', resetFormStatus);
  email.addEventListener('keydown', resetFormStatus);

  $(form.querySelector('.form-control-feedback')).popover({
    content: function () {
      return this.dataset.message;
    },
    container: 'body',
    placement: 'bottom',
    trigger: 'focus'
  });

  Scout(selector).on('submit', function (query) {
    query.action = action;
    query.data = {
      email: email.value
    };
    query.resp = callback;
    email.blur();
    submit.classList.add('disabled');
  });

}


// Remove the query string (e.g. '?key=123') from the URL.

function removeQueryString () {

  var search = window.location.search;

  if (search) {
    var url = String(window.location).replace(search, '');
    window.history.replaceState({}, document.title, url);
  }

};

removeQueryString();

