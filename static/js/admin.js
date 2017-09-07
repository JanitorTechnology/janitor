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

// Docker container tree button.
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
  text += image.Id.split(':')[1].slice(0, 16);
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
      container.Id.slice(0, 16) + ' Container (created: ' + created + ')';
  });

  // Format child images recursively.
  image.Children.forEach(function (child, i) {
    text += '\n' + formatContainerTree(child, childPrefix,
      i === image.Children.length - 1, image.VirtualSize);
  });

  return text;
}

// Docker container filesystem paths that can be ignored.
var diffHiddenPaths = {
  '/etc': true,
  '/home/user/.bash_history': true,
  '/home/user/.c9': true,
  '/home/user/.c9sdk': true,
  '/home/user/.cache': true,
  '/home/user/.ccache': true,
  '/home/user/.config': true,
  '/home/user/.dbus': true,
  '/home/user/.fehbg': true,
  '/home/user/.fluxbox': true,
  '/home/user/.emacs': true,
  '/home/user/.eslintrc': true,
  '/home/user/.gconf': true,
  '/home/user/.gdbinit': true,
  '/home/user/.gitconfig': true,
  '/home/user/.gitignore': true,
  '/home/user/.hgrc': true,
  '/home/user/.mozilla': true,
  '/home/user/.nanorc': true,
  '/home/user/.netrc': true,
  '/home/user/.novnc': true,
  '/home/user/.rnd': true,
  '/home/user/.ssh': true,
  '/home/user/.viminfo': true,
  '/home/user/.vimrc': true,
  '/home/user/.z': true,
  '/home/user/Desktop': true,
  '/home/user/Downloads': true,
  '/home/user/janitor.json': true,
  '/home/user/novnc': true,
  '/lib': true,
  '/run': true,
  '/tmp': true,
  '/usr': true,
  '/var': true,
};

// Docker container filesystem diff button.
Array.forEach(document.querySelectorAll('.docker-diff'), function (div) {
  var form = div.querySelector('form');
  var pre = div.querySelector('pre');
  window.setupAsyncForm(form);
  form.addEventListener('submit', function (event) {
    // Request the list of all files that were changed in this container.
    var url = '/api/hosts/' + form.dataset.hostname + '/containers/' +
      form.elements.container.value.trim() + '/changes';
    pre.textContent = 'Fetching filesystem changes…';
    window.fetchAPI('GET', url, null, function (error, changes) {
      if (error) {
        pre.textContent = error;
        return;
      }

      // Build the changes into a file tree.
      var tree = { Children: {}, TotalNodes: 0 };
      changes.forEach(function (change) {
        // Descend into the tree following the changed path.
        var node = tree;
        var paths = change.Path.slice(1).split('/');
        for (var i in paths) {
          var path = paths[i];
          var child = node.Children[path];
          // Create any missing branches along the way.
          if (!child) {
            child = node.Children[path] = { Children: {}, TotalNodes: 0 };
          }
          // Keep track of how many nodes this sub-tree contains.
          node.TotalNodes++;
          node = child;
        }
        // Import the change into the tree and create an HTML element for it.
        node.Hidden = diffHiddenPaths[change.Path] || false;
        node.Element = document.createElement('div');
        node.Element.textContent =
          ['M', 'A', 'D'][change.Kind] + ' ' + change.Path;
        node.Element.classList.add(node.Hidden
          ? 'diff-hidden'
          : ['diff-changed', 'diff-added', 'diff-deleted'][change.Kind]);
      });

      // Export the tree to HTML, sort paths alphabetically.
      var documentFragment = document.createDocumentFragment();
      var sortedPaths = Object.keys(tree.Children).sort();
      for (var i = 0; i < sortedPaths.length; i++) {
        var path = sortedPaths[i];
        exportDiffTree(documentFragment, tree.Children[path]);
      }
      pre.textContent = '';
      pre.appendChild(documentFragment);
    });
  });
});

// Export a Docker filesystem diff tree with hidden branches to HTML.
function exportDiffTree (element, node) {
  element.appendChild(node.Element);

  // By default, append child nodes to the same root element.
  var parentElement = element;
  if (node.Hidden && node.TotalNodes > 0) {
    // If this node is hidden, append its children to a collapsed <div> instead.
    parentElement = document.createElement('div');
    parentElement.classList.add('collapse');
    // Add a link to reveal hidden child nodes.
    var a = document.createElement('a');
    a.href = 'javascript:void(0)';
    a.textContent = node.TotalNodes + ' hidden';
    a.addEventListener('click', function (event) {
      window.$(parentElement).collapse('toggle');
    });
    node.Element.appendChild(document.createTextNode(' ('));
    node.Element.appendChild(a);
    node.Element.appendChild(document.createTextNode(')'));
    element.appendChild(parentElement);
  }

  // Export all child nodes recursively, in alphabetical order.
  var sortedPaths = Object.keys(node.Children).sort();
  for (var i = 0; i < sortedPaths.length; i++) {
    var path = sortedPaths[i];
    exportDiffTree(parentElement, node.Children[path]);
  }
}
