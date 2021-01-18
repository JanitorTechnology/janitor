// Copyright © 2015 Team Janitor. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

// Polyfill a few basic things.
['filter', 'forEach', 'map', 'reduce'].forEach(function (name) {
  Array[name] = function (array, callback, init) {
    return [][name].call(array, callback, init);
  };
});

// Automatically set up asynchronous JSON forms (all with a 'method' attribute).
Array.forEach(document.querySelectorAll('form[method]'), function (form) {
  setupAsyncForm(form);
  form.addEventListener('submit', function (event) {
    const elements = Array.filter(form.elements, function (element) {
      // Only consider `form.elements` that have a `name` attribute.
      return !!element.name;
    }).map(function (element) {
      // Extract values, properly handling elements with `type="checkbox"`.
      return {
        name: element.name,
        value: element.type === 'checkbox' ? element.checked : element.value
      };
    });

    // Build a JSON payload containing the submitted form data.
    let data = {};
    const method = form.getAttribute('method').toUpperCase();
    if (method === 'PATCH') {
      // Set up JSON Patch forms to submit an Array of JSON Patch operations.
      // See also: RFC 6902 - JSON Patch.
      data = elements.map(function (element) {
        return { op: 'add', path: element.name, value: element.value };
      });
    } else {
      // By default, submit a JSON Object that maps element names and values.
      elements.forEach(function (element) {
        data[element.name] = element.value;
      });
    }

    // Submit the JSON payload to the specified `form.action` URL.
    fetchAPI(method, form.action, data, function (error, data) {
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
  const id = '#' + form.getAttribute('id');
  const action = form.dataset.action;

  ajaxForm(id, action, function (form, data) {
    updateFormStatus(form, data.status, data.message);
  });
});

// FIXME: Remove this deprecated function.
// Set up an ajax <form>.
function ajaxForm (selector, action, callback) {
  const form = document.querySelector(selector);
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
    Array.forEach(form.elements, function (element) {
      element.classList.add('disabled');
    });
  });
}

// Use `window.fetch()` to make an asynchronous Janitor API request.
function fetchAPI (method, url, data, callback) {
  let responseStatus = null;
  const options = {
    method: method.toUpperCase(),
    headers: new Headers({
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }),
    credentials: 'same-origin'
  };

  // Requests with method 'GET' or 'HEAD' cannot have `options.body`.
  if (data && ['GET', 'HEAD'].indexOf(options.method) < 0) {
    options.body = JSON.stringify(data, null, 2);
  }

  window.fetch(url, options).then(function (response) {
    // The server is responding!
    responseStatus = response.status;
    return responseStatus === 204 ? null : response.json();
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

  form.addEventListener('submit', function (event) {
    // Disable all form elements while waiting for the server.
    Array.forEach(form.elements, function (element) {
      if (element.classList.contains('form-control-feedback')) {
        return;
      }
      element.classList.add('disabled');
    });
    // Ensure that submitting the <form> doesn't reload the page.
    event.preventDefault();
  });
}

// Update the visual feedback of a <form>'s status.
function updateFormStatus (form, status, message) {
  form.classList.remove('has-success', 'has-error');
  switch (status) {
    case 'success':
      form.classList.add('has-success');
      break;
    case 'error':
      form.classList.add('has-error');
      break;
  }

  Array.forEach(form.elements, function (element) {
    element.classList.remove('disabled');
  });

  const feedback = form.querySelector('.form-control-feedback');

  // Reset the custom validity message so the element isn't invalid anymore,
  // and the form can be submitted.
  if (feedback) {
    feedback.setCustomValidity('');
  }

  if (message && feedback) {
    // Set a custom validation message on the form feedback button.
    feedback.setCustomValidity(message);
    // Force the display of the custom validity message.
    form.reportValidity();
  }

  if (form.dataset.refreshAfterSuccess && status === 'success') {
    setTimeout(function () {
      location.reload();
    }, 400);
  }

  if (form.dataset.redirectAfterSuccess && status === 'success') {
    setTimeout(function () {
      location.href = form.dataset.redirectAfterSuccess;
    }, 400);
  }
}

// Add visual feedback elements to a given <form>.
function addFormFeedback (form) {
  const feedback = document.createElement('button');
  feedback.classList.add('form-control-feedback');
  feedback.setAttribute('tabindex', '99');

  // Append icons for 'success' and 'error' states.
  ['ok', 'remove'].forEach(function (name) {
    const icon = document.createElement('span');
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
    const name = element.name;
    if (name && !(name in data)) {
      data[name] = element.type === 'checkbox' ? element.checked : element.value;
    }
    return data;
  }, {});
}

// Setup editable labels.
Array.forEach(document.querySelectorAll('.editable-label'), function (label) {
  const toggle = label.querySelector('.editable-toggle');
  if (!toggle) {
    console.error('Editable label', label, 'has no ".editable-toggle" element!');
    return;
  }
  toggle.addEventListener('click', function () {
    label.classList.add('editing');
    label.querySelector('.editable-editor input').select();
  });
});

// Setup modals
$('.modal-form').on('show.bs.modal', function (event) {
  const menuItem = $(event.relatedTarget);
  $(this).find('.modal-title').text(menuItem.data('confirm'));
  $(this).find('.modal-details').text(menuItem.data('details'));
  $(this).find('button[type="submit"]').text(menuItem.text());
  $(this).find('.ajax-form').attr('method', menuItem.data('form-method'));
  $(this).find('.ajax-form').attr('action', menuItem.data('form-action'));
});

$('.modal-form').on('hidden.bs.modal', function (event) {
  $(this).find('.modal-title').text('');
  $(this).find('.modal-details').text('');
  $(this).find('button[type="submit"]').text('');
  $(this).find('.ajax-form').removeAttr('method');
  $(this).find('.ajax-form').removeAttr('action');
});

// Remove the query string (e.g. '?key=123') from the URL.
if (window.location.search) {
  const url = String(window.location).replace(window.location.search, '');
  window.history.replaceState({}, document.title, url);
}

// Add helpful anchor links to title elements with an 'id' attribute.
Array.forEach(document.querySelectorAll('h1[id],h2[id]'), element => {
  const link = document.createElement('a');
  link.href = '#' + element.id;
  link.textContent = '#';
  const small = document.createElement('small');
  small.classList.add('show-on-hover');
  small.appendChild(link);
  element.appendChild(document.createTextNode(' '));
  element.appendChild(small);
});

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
