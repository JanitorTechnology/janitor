

// Alpha sign-up form.

emailForm('#signup-form', 'signup', function (data) {

  var form = document.querySelector('#signup-form');

  if (data.status === 'added' || data.status === 'already-added') {
    updateFormStatus(form, 'success');
  } else {
    updateFormStatus(form, 'error');
  }

});


// Email-login form.

emailForm('#login-form', 'login', function (data) {

  var form = document.querySelector('#login-form');

  if (data.status === 'logged-in' || data.status === 'email-sent') {
    updateFormStatus(form, 'success');
  } else {
    updateFormStatus(form, 'error');
  }
});


// Update the visual feedback of an ajax form's status.

function updateFormStatus (form, status) {

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

