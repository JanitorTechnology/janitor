// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

/* global Scout, $ */

// Spawn a project-specific machine when one of its links is clicked.

Array.map(document.querySelectorAll('a[data-action="spawn"]'), function (link) {
  link.addEventListener('click', Scout.send(function (query) {
    query.action = link.dataset.action;
    query.data = {
      project: link.dataset.project
    };
    query.resp = function (data) {
      document.location = '/contributions/';
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

Array.map(document.querySelectorAll('*[data-timestamp]'), function (element) {
  var date = new Date(parseInt(element.dataset.timestamp));

  // GMT is deprecated (see https://en.wikipedia.org/wiki/UTC).
  element.title = date.toUTCString().replace('GMT', 'UTC');
  element.setAttribute('datetime', date.toISOString());

  // Use jQuery's live-updating timeago plugin.
  $(element).timeago();
});

// Request confirmation before deleting a project-specific machine.

$('#confirm').on('show.bs.modal', function (event) {
  var link = event.relatedTarget;
  var title = this.querySelector('#confirm-title');
  var details = this.querySelector('#confirm-details');
  var button = this.querySelector('#confirm-button');

  title.textContent = link.dataset.confirm;
  details.textContent = link.dataset.details;
  button.textContent = link.textContent;

  button.onclick = Scout.send(function (query) {
    query.action = link.dataset.action;
    query.data = {
      machine: link.dataset.machine,
      project: link.dataset.project
    };
    query.resp = function (data) {
      switch (data.status) {
        case 'success':
          document.location.reload();
          break;
        case 'error':
          // FIXME: Display errors better.
          alert(data.message);
          break;
      }
    };
  });
});

// Clean up the confirmation screen when dismissed.

$('#confirm').on('hidden.bs.modal', function (event) {
  var title = this.querySelector('#confirm-title');
  var details = this.querySelector('#confirm-details');
  var button = this.querySelector('#confirm-button');

  title.textContent = '';
  details.textContent = '';
  button.textContent = '';

  button.onclick = null;
});
