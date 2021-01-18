// Copyright © 2015 Team Janitor. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

// Helpers
const $ = function (selector, target) {
  if (!target) {
    target = document;
  }
  return target.querySelector(selector);
};

const $$ = function (selector, target) {
  if (!target) {
    target = document;
  }
  return target.querySelectorAll(selector);
};

// Polyfill a few basic things.
['filter', 'forEach', 'map', 'reduce', 'some'].forEach(function (name) {
  Array[name] = function (array, callback, init) {
    return [][name].call(array, callback, init);
  };
});

// Setup tabs
Array.forEach($$('.tabs'), function (element) {
  const nav = $('.tab-nav', element);
  Array.forEach($$('.tab', nav), function (tab) {
    tab.addEventListener('click', function (event) {
      const newSelected = '[data-tab=' + tab.dataset.tab + ']';
      const currentSelected = $$('.tab-panel.selected, .tab.selected', element);
      if (currentSelected.length > 0) {
        Array.forEach(currentSelected, function (panel) {
          panel.classList.remove('selected');
        });
      }
      Array.forEach($$('.tab' + newSelected + ', .tab-panel' + newSelected, element), function (selected) {
        selected.classList.add('selected');
      });
      event.preventDefault();
    });
  });

  // Select first element
  nav.firstElementChild.click();
});

// Automatically set up asynchronous JSON forms (all with a 'method' attribute).
Array.forEach(document.querySelectorAll('form[method]'), function (form) {
  setupAsyncForm(form);
  form.addEventListener('submit', function (event) {
    // Set form to pending status
    updateFormStatus(form, 'pending');

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
    // Ensure that submitting the <form> doesn't reload the page.
    event.preventDefault();
  });
}

// Update the visual feedback of a <form>'s status.
function updateFormStatus (form, status, message) {
  form.classList.remove('success', 'error', 'pending');

  switch (status) {
    case 'pending':
      form.classList.add('pending');

      // Disable all form elements while waiting for the server.
      Array.forEach(form.elements, function (element) {
        if (element.classList.contains('form-control-feedback')) {
          return;
        }
        element.classList.add('disabled');
      });
      break;
    case 'success':
      form.classList.add('success');
      break;
    case 'error':
      form.classList.add('error');
      break;
  }
  const feedback = form.querySelector('.form-control-feedback');

  // Reset the custom validity message so the element isn't invalid anymore,
  // and the form can be submitted.
  if (feedback || status === 'pending') {
    feedback.setCustomValidity('');
  }

  if (message && feedback) {
    // Set a custom validation message on the form feedback button.
    feedback.setCustomValidity(message);
    // Force the display of the custom validity message.
    form.reportValidity();
  }

  // Re-enable form fields once we receive a server response
  if (status !== 'pending') {
    Array.forEach(form.elements, function (element) {
      element.classList.remove('disabled');
    });
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

  form.appendChild(feedback);
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

// Remove the query string (e.g. '?key=123') from the URL.
if (window.location.search) {
  const url = String(window.location).replace(window.location.search, '');
  window.history.replaceState({}, document.title, url);
}

// Add helpful anchor links to title elements with an 'id' attribute.
Array.forEach(document.querySelectorAll('h1[id],h2[id]'), function (element) {
  const link = document.createElement('a');
  link.href = '#' + element.id;
  link.classList.add('icon', 'link', 'icon-button');
  element.appendChild(link);
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
