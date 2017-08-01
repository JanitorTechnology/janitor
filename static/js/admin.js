// Copyright © 2015 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

// Alpha version invite form.
ajaxForm('#invite-form', 'invite', function (form, data) {
  var status = 'error';
  var message = data.message;

  switch (data.status) {
    case 'already-invited':
      status = 'success';
      message = 'This person is already invited';
      form.elements.email.value = '';
      break;
    case 'invited':
      status = 'success';
      message = 'Invite sent!';
      form.elements.email.value = '';
      break;
  }

  updateFormStatus(form, status, message);
});

// New host form.
var newHostForm = document.querySelector('#newhost-form');
if (newHostForm) {
  window.setupAsyncForm(newHostForm);
  newHostForm.addEventListener('submit', function (event) {
    var hostname = newHostForm.elements.hostname.value;
    window.fetchAPI('POST', '/api/hosts/' + hostname, {}, function (error, data) {
      if (error) {
        updateFormStatus(newHostForm, 'error', String(error));
        return;
      }
      updateFormStatus(newHostForm, 'success', data ? data.message : null);
      setTimeout(function () {
        location.reload();
      }, 400);
    });
  });
}

// New project form.
ajaxForm('#newproject-form', 'projectdb', function (form, data) {
  var status = 'error';
  var message = data.message;

  switch (data.status) {
    case 'success':
      status = 'success';
      message = 'Project added!';
      document.location.reload();
      break;
  }

  updateFormStatus(form, status, message);
});

// Project update buttons.
Array.map(document.querySelectorAll('button[data-action]'), function (button) {
  button.addEventListener('click', Scout.send(function (query) {
    query.action = button.dataset.action;
    query.data = {
      project: button.dataset.project
    };
    query.resp = function (data) {
      document.location.reload();
    };
  }));
});

// Docker version button.
Array.forEach(document.querySelectorAll('.docker-version'), function (div) {
  var button = div.querySelector('button');
  var pre = div.querySelector('pre');
  button.addEventListener('click', function (event) {
    var url = '/api/hosts/' + button.dataset.hostname + '/version';
    pre.textContent = 'Fetching version…';
    window.fetchAPI('GET', url, null, function (error, version) {
      if (error) {
        pre.textContent = error;
        return;
      }
      pre.textContent = JSON.stringify(version, null, 2);
    });
  });
});

// Docker Container tree button.
Array.forEach(document.querySelectorAll('.docker-tree'), function (div) {
  var button = div.querySelector('button');
  var pre = div.querySelector('pre');
  button.addEventListener('click', function (event) {
    // Request the list of all Docker images on this host.
    var hostUrl = '/api/hosts/' + button.dataset.hostname;
    var imagesUrl = hostUrl + '/images';
    pre.textContent = 'Fetching images…';
    window.fetchAPI('GET', imagesUrl, null, function (error, data) {
      if (error) {
        pre.textContent = error;
        return;
      }

      // Build a flat index of all images, indexed by Id.
      pre.textContent += '\nIndexing images…';
      var images = data.reduce(function (images, image) {
        images[image.Id] = image;
        // Clean up image structure somewhat.
        image.Children = [];
        image.Containers = [];
        image.RepoTags = (image.RepoTags || []).filter(function (tag) {
          return !tag.includes('<none>');
        });
        return images;
      }, {});

      // Build the image hierarchy into a tree.
      pre.textContent += '\nBuilding image tree…';
      var tree = {};
      for (var Id in images) {
        var image = images[Id];
        var parent = images[image.ParentId];
        if (!parent) {
          // This image has no parent, so we place it at the root of the tree.
          tree[Id] = image;
          continue;
        }
        parent.Children.push(image);
      }

      // Request the list of all Docker containers on this host.
      var containersUrl = hostUrl + '/containers';
      pre.textContent += '\nFetching containers…';
      window.fetchAPI('GET', containersUrl, null, function (error, data) {
        if (error) {
          pre.textContent = error;
          return;
        }
        // Add all containers to the image tree.
        pre.textContent += '\nAdding containers…';
        data.forEach(function (container) {
          images[container.ImageID].Containers.push(container);
        });
        // Export the tree in text format.
        pre.textContent += '\nExporting tree…';
        var text = '';
        for (var id in tree) {
          text += formatContainerTree(tree[id]) + '\n';
        }
        pre.textContent = text;
      });
    });
  });
});

// Format a Docker container tree into human readable text.
function formatContainerTree (image, linePrefix, lastChild, parentSize) {
  linePrefix = linePrefix || '';
  lastChild = lastChild || false;
  parentSize = parentSize || 0;

  // Simplify the tree by skipping over long branches with no forks.
  while (image.Children.length === 1 && image.RepoTags.length === 0) {
    image = image.Children[0];
  }

  // Format tree branches, image ID and any tags.
  var text = linePrefix + (lastChild ? '└─' : '├─');
  text += image.Id.split(':')[1].slice(0, 12);
  text += ' ' + window.formatMemory(image.VirtualSize - parentSize);
  if (image.RepoTags.length > 0) {
    text += ' (tags: ' + image.RepoTags.join(', ') + ')';
  }

  var childPrefix = linePrefix + (lastChild ? '  ' : '│ ');

  // Format container IDs and creation dates.
  image.Containers.forEach(function (container, i) {
    var created = new Date(container.Created * 1000)
      .toISOString().split('T')[0];
    text += '\n' + childPrefix +
      (i === image.Containers.length - 1 ? '└─' : '├─') +
      container.Id.slice(0, 12) + ' Container (created: ' + created + ')';
  });

  // Format child images recursively.
  image.Children.forEach(function (child, i) {
    text += '\n' + formatContainerTree(child, childPrefix,
      i === image.Children.length - 1, image.VirtualSize);
  });

  return text;
}
