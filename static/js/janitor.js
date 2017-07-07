// Copyright © 2015 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

// Polyfill a few basic things.
['filter', 'forEach', 'map', 'reduce'].forEach(function (name) {
  Array[name] = function(array, callback, init) {
    return [][name].call(array, callback, init);
  };
});

// Automatically set up button forms (when their 'method' is 'delete' or 'put').
Array.forEach(document.querySelectorAll('form[method=delete], form[method=put]'), function (form) {
  setupAsyncForm(form);
  form.addEventListener('submit', function (event) {
    var data = getFormData(form);
    var method = form.getAttribute('method').toUpperCase();
    fetchAPI(method, form.action, data, function (error, data) {
      if (error) {
        updateFormStatus(form, 'error', String(error));
        return;
      }

      updateFormStatus(form, 'success', data ? data.message : null);
    });
  });
});

// Automatically set up JSON Patch forms (when their 'method' is 'patch').
// See also: RFC 6902 - JSON Patch.
Array.forEach(document.querySelectorAll('form[method=patch]'), function (form) {
  setupAsyncForm(form);
  form.addEventListener('submit', function (event) {
    // Convert named `form.elements` to an Array of JSON Patch operations.
    var elements = Array.filter(form.elements, function (element) {
      return element.name;
    });
    var operations = elements.map(function (element) {
      return { op: 'add', path: element.name, value: element.value };
    });

    fetchAPI('PATCH', form.action, operations, function (error, data) {
      if (error) {
        updateFormStatus(form, 'error', String(error));
        return;
      }

      updateFormStatus(form, 'success', data ? data.message : null);
    });
  });
});

// FIXME: Remove this deprecated code.
// Automatically set up simple ajax forms (with 'data-action' attribute).
Array.forEach(document.querySelectorAll('form[data-action]'), function (form) {
  var id = '#' + form.getAttribute('id');
  var action = form.dataset.action;

  ajaxForm(id, action, function (form, data) {
    updateFormStatus(form, data.status, data.message);
  });
});

// FIXME: Remove this deprecated function.
// Set up an ajax <form>.
function ajaxForm (selector, action, callback) {
  var form = document.querySelector(selector);
  if (!form) {
    return;
  }

  setupAsyncForm(form);

  // Set-up the <form>'s ajax call.
  Scout(selector).on('submit', function (query) {
    query.action = action;
    query.data = getFormData(form);
    query.resp = function (data) {
      callback(form, data);
    };
    Array.map(form.elements, function (element) {
      element.blur();
      element.classList.add('disabled');
    });
  });
}

// Use `window.fetch()` to make an asynchronous Janitor API request.
function fetchAPI (method, url, data, callback) {
  var responseStatus = null;

  window.fetch(url, {
    method: method.toUpperCase(),
    headers: new Headers({
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }),
    credentials: 'same-origin',
    body: JSON.stringify(data, null, 2)
  }).then(function (response) {
    // The server is responding!
    responseStatus = response.status;
    return responseStatus == 204 ? null : response.json();
  }).then(function (data) {
    // The response body was successfully parsed as JSON!
    if (data && data.error) {
      // The parsed JSON contains an error message.
      throw new Error(data.error);
    }

    if (responseStatus < 200 || responseStatus >= 300) {
      // The response status indicates something went wrong.
      throw new Error('Response status: ' + responseStatus);
    }

    // The request was successful!
    callback(null, data);
  }).catch(function (error) {
    // The request failed!
    callback(error);
  });
}

// Set up a <form> element that submits asynchronously.
function setupAsyncForm (form) {
  if (!form) {
    return;
  }

  // Re-enable all fields and hide any previous feedback.
  function resetFormStatus () {
    updateFormStatus(form);
  }

  // Process all <form> input elements (like <input>, <textarea>, …).
  Array.forEach(form.elements, function (element) {
    element.addEventListener('change', resetFormStatus);
    element.addEventListener('keydown', resetFormStatus);
  });


  // Elements can specify an event to submit the <form>.
  Array.forEach(form.querySelectorAll('[data-submit-on]'), function (element) {
    element.addEventListener(element.dataset.submitOn, function (event) {
      form.dispatchEvent(new Event('submit', { cancelable: true }));
    });
  });

  // Set-up the <form>'s visual feedback if needed.
  if (form.classList.contains('has-feedback')) {
    addFormFeedback(form);
  }

  // Ensure that submitting the <form> doesn't reload the page.
  form.addEventListener('submit', function (event) {
    event.preventDefault();
  });
}

// Update the visual feedback of a <form>'s status.
function updateFormStatus (form, status, message) {
  // Get the targetted form element which should receive the form feedback.
  const targetElement = form.querySelector('.form-feedback-target');

  form.classList.remove('has-success', 'has-error');
  // Reset the custom validity message so the element isn't invalid anymore,
  // and the form can be submitted.
  targetElement.setCustomValidity('');

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
    // Set a custom validation message on the target form element.
    targetElement.setCustomValidity(message);
    // Force the display of thecustom validity message.
    form.reportValidity();
  }

  if (form.dataset.refreshAfterSuccess && status == 'success') {
    setTimeout(function () {
      location.reload();
    }, 400);
  }
}

// Add visual feedback elements to a given <form>.
function addFormFeedback (form) {
  var feedback = document.createElement('div');
  feedback.classList.add('form-control-feedback');
  feedback.setAttribute('tabindex', '99');

  // Append icons for 'success' and 'error' states.
  ['ok', 'remove'].forEach(function (name) {
    var icon = document.createElement('span');
    icon.classList.add('glyphicon', 'glyphicon-' + name);
    icon.setAttribute('aria-hidden', 'true');
    feedback.appendChild(icon);
  });

  form.appendChild(feedback);
}

// FIXME: Remove this deprecated function.
// Extract the values of all named fields in a given <form>.
function getFormData (form) {
  return Array.reduce(form.elements, function (data, element) {
    var name = element.name;
    if (name && !(name in data)) {
      data[name] = element.value;
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

// If the web browser supports it, register and install a Service Worker.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js', { scope: '/' })
    .then(function (registration) {
      // Successfully registered.
    })
    .catch(function (error) {
      // Couldn't register.
      console.error(error);
    });
}
