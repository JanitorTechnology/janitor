// Copyright © 2015 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPLv3 license.


// Polyfill a few basic things.

['forEach', 'map', 'reduce'].forEach(function (name) {
  Array[name] = function(array, callback, init) {
    return [][name].call(array, callback, init);
  };
});


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


// Account: Cloud9 SSH key form.

ajaxForm('#cloud9-form', 'key', function (form, data) {

  var status = 'error';
  var message = data.message;

  if (data.status === 'key-saved') {
    status = 'success';
  }

  updateFormStatus(form, status, message);

});


// Update the visual feedback of an ajax form's status.

function updateFormStatus (form, status, message) {

  form.classList.remove('has-success', 'has-error');

  switch (status) {
    case 'success':
      form.classList.add('has-success');
      break;
    case 'error':
      form.classList.add('has-error');
      break;
    default:
      Array.map(form.elements, function (element) {
        element.classList.remove('disabled');
      });
      break;
  }

  var feedback = form.querySelector('.form-control-feedback');

  if (message && feedback) {
    feedback.dataset.message = message;
    feedback.focus();
  }

}


// Set-up an ajax form.

function ajaxForm (selector, action, callback) {

  var form = document.querySelector(selector);

  if (!form) {
    return;
  }

  // Re-enable all fields and hide previous feedback.
  function resetFormStatus () {
    updateFormStatus(form);
  }

  // Process all form input elements (like <input>, <textarea>, …).
  Array.map(form.elements, function (element) {
    element.addEventListener('change', resetFormStatus);
    element.addEventListener('keydown', resetFormStatus);

    // Elements can specify an event to submit the form.
    var submitOn = element.dataset.submitOn;
    if (submitOn) {
      element.addEventListener(submitOn, function () {
        form.dispatchEvent(new Event('submit'));
      });
    }
  });

  // Set-up the feedback message box (a bootstrap popover).
  $(form.querySelector('.form-control-feedback')).popover({
    content: function () {
      return this.dataset.message;
    },
    container: 'body',
    placement: 'bottom',
    trigger: 'focus'
  });

  // Set-up the form's ajax call.
  Scout(selector).on('submit', function (query) {
    query.action = action;
    query.data = getFormData(form);
    query.resp = function (data) {
      callback(form, data);
    }
    Array.map(form.elements, function (element) {
      element.blur();
      element.classList.add('disabled');
    });
  });

}


// Extract the values of all named fields in a given form.

function getFormData (form) {

  return Array.reduce(form.elements, function (data, element) {
    var name = element.name;
    if (name && !(name in data)) {
      data[element.name] = element.value;
    }
    return data;
  }, {});

}


// Remove the query string (e.g. '?key=123') from the URL.

function removeQueryString () {

  var search = window.location.search;

  if (search) {
    var url = String(window.location).replace(search, '');
    window.history.replaceState({}, document.title, url);
  }

}

removeQueryString();
