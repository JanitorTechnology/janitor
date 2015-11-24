// Copyright © 2015 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.


// Polyfill a few basic things.

['forEach', 'map', 'reduce'].forEach(function (name) {
  Array[name] = function(array, callback, init) {
    return [][name].call(array, callback, init);
  };
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

  // Set-up the form's visual feedback if needed.
  if (form.classList.contains('has-feedback')) {
    addFormFeedback(form);
  }

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


// Add visual feedback elements to a given form.

function addFormFeedback (form) {

  var feedback = document.createElement('div');
  feedback.classList.add('form-control-feedback');
  feedback.dataset.message = '';
  feedback.setAttribute('tabindex', '99');

  // Append icons for 'success' and 'error' states.
  ['ok', 'remove'].forEach(function (name) {
    var icon = document.createElement('span');
    icon.classList.add('glyphicon', 'glyphicon-' + name);
    icon.setAttribute('aria-hidden', 'true');
    feedback.appendChild(icon);
  });

  // Set-up the feedback message box (a bootstrap popover).
  $(feedback).popover({
    content: function () {
      return this.dataset.message;
    },
    container: 'body',
    placement: 'bottom',
    trigger: 'focus'
  });

  form.appendChild(feedback);

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
