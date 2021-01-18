// Copyright © 2016 Team Janitor. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

// Add status badges to elements with a 'data-status' attribute.

Array.map(document.querySelectorAll('*[data-status]'), function (element) {
  const status = element.dataset.status;

  // Format the status.
  element.title = 'Status: ' + status.split('-').join(' ');

  // Choose a relevant status class.
  const classMap = {
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
const timestampElements = document.querySelectorAll('[data-timestamp]');
Array.forEach(timestampElements, function (element) {
  const date = new Date(parseInt(element.dataset.timestamp));

  // GMT is deprecated (see https://en.wikipedia.org/wiki/UTC).
  element.title = date.toUTCString().replace('GMT', 'UTC');
  element.setAttribute('datetime', date.toISOString());

  // Use live-updating timeago plugin.
  timeago().render(element);
});

const cardSearchBox = document.querySelector('[data-search-cards]');
cardSearchBox.addEventListener('input', function () {
  const words = cardSearchBox.value.toLowerCase().split(/\s+/);
  const cardsContainerId = cardSearchBox.getAttribute('data-search-cards');
  const cards = document.getElementById(cardsContainerId).querySelectorAll('.card');
  Array.forEach(cards, function (element) {
    const cardText = element.getAttribute('data-search-text');
    element.hidden = Array.some(words, function (word) {
      return cardText.indexOf(word) < 0;
    });
  });
});
