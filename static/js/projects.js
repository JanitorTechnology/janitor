// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

// Spawn a project-specific machine when one of its links is clicked.

Array.map(document.querySelectorAll('a[data-action="spawn"]'), function (link) {
  link.addEventListener('click', Scout.send(function (query) {
    query.action = link.dataset.action;
    query.data = {
      project: link.dataset.project
    };
    query.resp = function (data) {
      document.location = '/containers/';
    };
  }));
});

// Add status badges to elements with a 'data-status' attribute.

Array.map(document.querySelectorAll('*[data-status]'), function (element) {
  var span = document.createElement('span');
  var status = element.dataset.status;

  // Format the status.
  span.textContent = status.split('-').join(' ');
  span.classList.add('text-capitalize');

  // Choose a relevant bootstrap label class.
  var label = {
    started: 'success',
    accepted: 'success',
    rejected: 'warning',
    merged: 'primary'
  };
  label['build-failed'] = 'danger';
  label['start-failed'] = 'danger';
  label['update-failed'] = 'warning';
  span.classList.add('label', 'label-' + (label[status] || 'default'));

  element.appendChild(span);
});

// Add fuzzy timestamps to elements with a 'data-timestamp' attribute.
var timestampElements = document.querySelectorAll('[data-timestamp]');
Array.forEach(timestampElements, function (element) {
  var date = new Date(parseInt(element.dataset.timestamp));

  // GMT is deprecated (see https://en.wikipedia.org/wiki/UTC).
  element.title = date.toUTCString().replace('GMT', 'UTC');
  element.setAttribute('datetime', date.toISOString());

  // Use live-updating timeago plugin.
  timeago().render(element);
});
