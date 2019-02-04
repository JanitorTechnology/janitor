// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

// Spawn a project-specific machine when one of its links is clicked.
Array.forEach(document.querySelectorAll('.new-container'), function (form) {
  window.setupAsyncForm(form);
  form.addEventListener('submit', function (event) {
    var url = '/api/hosts/' + form.dataset.host +
      '/containers?project=' + form.dataset.project;
    window.fetchAPI('PUT', url, null, function(error, data) {
      if (error) {
        window.updateFormStatus(form, 'error', String(error));
        return;
      }
      window.updateFormStatus(form, 'success', null);
      setTimeout(function () {
        document.location.href =
          '/containers/#' + data.container.slice(0, 16);
      }, 400);
    });
  });
});

// Add status badges to elements with a 'data-status' attribute.
Array.map(document.querySelectorAll('*[data-status]'), function (element) {
  var status = element.dataset.status;

  // Format the status.
  element.title = 'Status: ' + status.split('-').join(' ');

  // Choose a relevant status class.
  var classMap = {
    started: 'success',
    accepted: 'success',
    rejected: 'warning',
    merged: 'primary'
  };
  classMap['build-failed'] = 'error';
  classMap['start-failed'] = 'error';
  classMap['update-failed'] = 'warning';
  element.classList.add(classMap[status] || 'default');
});

// Add fuzzy timestamps to elements with a 'data-timestamp' attribute.
Array.forEach(document.querySelectorAll('*[data-timestamp]'), function (element) {
  var date = new Date(parseInt(element.dataset.timestamp, 10));

  // GMT is deprecated (see https://en.wikipedia.org/wiki/UTC).
  element.title = date.toUTCString().replace('GMT', 'UTC');
  element.setAttribute('datetime', date.toISOString());

  // Use live-updating timeago plugin.
  timeago().render(element);
});

var cardSearchBox = document.querySelector('[data-search-cards]');
cardSearchBox.addEventListener('input', function () {
  var words = cardSearchBox.value.toLowerCase().split(/\s+/);
  var cardsContainerId = cardSearchBox.getAttribute('data-search-cards');
  var cards = document.getElementById(cardsContainerId).querySelectorAll('.card');
  Array.forEach(cards, function (element) {
    var cardText = element.getAttribute('data-search-text');
    element.hidden = Array.some(words, function (word) {
      return cardText.indexOf(word) < 0;
    });
  });
});
