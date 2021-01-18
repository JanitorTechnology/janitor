// Copyright © 2015 Team Janitor. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

// Alpha version invite form.
ajaxForm('#invite-form', 'invite', function (form, data) {
  let status = 'error';
  let message = data.message;

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
const newHostForm = document.querySelector('#newhost-form');
if (newHostForm) {
  window.setupAsyncForm(newHostForm);
  newHostForm.addEventListener('submit', function (event) {
    const hostname = newHostForm.elements.hostname.value;
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
  let status = 'error';
  let message = data.message;

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

// Azure Virtual Machines button.
Array.forEach(document.querySelectorAll('.azure-virtual-machines'), function (div) {
  const button = div.querySelector('button');
  const pre = div.querySelector('pre');
  button.addEventListener('click', function (event) {
    const url = '/api/admin/azure/virtualmachines';
    pre.textContent = 'Fetching virtual machines…';
    window.fetchAPI('GET', url, null, function (error, virtualMachines) {
      if (error) {
        pre.textContent = error;
        return;
      }
      pre.textContent = JSON.stringify(virtualMachines, null, 2);
    });
  });
});

// Docker version button.
Array.forEach(document.querySelectorAll('.docker-version'), function (div) {
  const button = div.querySelector('button');
  const pre = div.querySelector('pre');
  button.addEventListener('click', function (event) {
    const url = '/api/hosts/' + button.dataset.hostname + '/version';
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
  const button = div.querySelector('button');
  const pre = div.querySelector('pre');
  button.addEventListener('click', function (event) {
    // Request the list of all Docker images on this host.
    const hostUrl = '/api/hosts/' + button.dataset.hostname;
    const imagesUrl = hostUrl + '/images';
    pre.textContent = 'Fetching images…';
    window.fetchAPI('GET', imagesUrl, null, function (error, data) {
      if (error) {
        pre.textContent = error;
        return;
      }

      // Build a flat index of all images, indexed by Id.
      pre.textContent += '\nIndexing images…';
      const images = data.reduce(function (images, image) {
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
      const tree = {};
      for (const Id in images) {
        const image = images[Id];
        const parent = images[image.ParentId];
        if (!parent) {
          // This image has no parent, so we place it at the root of the tree.
          tree[Id] = image;
          continue;
        }
        parent.Children.push(image);
      }

      // Request the list of all Docker containers on this host.
      const containersUrl = hostUrl + '/containers';
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
        let text = '';
        for (const id in tree) {
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
  let text = linePrefix + (lastChild ? '└─' : '├─');
  text += image.Id.split(':')[1].slice(0, 16);
  text += ' ' + window.formatMemory(image.VirtualSize - parentSize);
  if (image.RepoTags.length > 0) {
    text += ' (tags: ' + image.RepoTags.join(', ') + ')';
  }

  const childPrefix = linePrefix + (lastChild ? '  ' : '│ ');

  // Format container IDs and creation dates.
  image.Containers.forEach(function (container, i) {
    const created = new Date(container.Created * 1000)
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
const diffHiddenPaths = {
  '/etc': true,
  '/home/user/.bash_history': true,
  '/home/user/.bashrc': true,
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
  '/home/user/.mozbuild': true,
  '/home/user/.mozilla': true,
  '/home/user/.nanorc': true,
  '/home/user/.netrc': true,
  '/home/user/.novnc': true,
  '/home/user/.rnd': true,
  '/home/user/.ssh': true,
  '/home/user/.thunderbird': true,
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
  const form = div.querySelector('form');
  const pre = div.querySelector('pre');
  window.setupAsyncForm(form);
  form.addEventListener('submit', function (event) {
    // Request the list of all files that were changed in this container.
    const url = '/api/hosts/' + form.dataset.hostname + '/containers/' +
      form.elements.container.value.trim() + '/changes';
    pre.textContent = 'Fetching filesystem changes…';
    window.fetchAPI('GET', url, null, function (error, changes) {
      if (error) {
        pre.textContent = error;
        return;
      }

      // Build the changes into a file tree.
      const tree = { Children: {}, TotalNodes: 0 };
      changes.forEach(function (change) {
        // Descend into the tree following the changed path.
        let node = tree;
        const paths = change.Path.slice(1).split('/');
        for (const i in paths) {
          const path = paths[i];
          // Create any missing branches along the way.
          if (!Object.prototype.hasOwnProperty.call(node.Children, path)) {
            node.Children[path] = { Children: {}, TotalNodes: 0 };
          }
          // Keep track of how many nodes this sub-tree contains.
          node.TotalNodes++;
          node = node.Children[path];
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
      const documentFragment = document.createDocumentFragment();
      const sortedPaths = Object.keys(tree.Children).sort();
      for (let i = 0; i < sortedPaths.length; i++) {
        const path = sortedPaths[i];
        exportDiffTree(documentFragment, tree.Children[path]);
      }
      pre.textContent = '';
      pre.appendChild(documentFragment);
    });
  });
});

// Export a Docker filesystem diff tree with hidden branches to HTML.
function exportDiffTree (element, node) {
  if (node.Element) {
    // Append the node's element if it has one.
    // Note: For some folders, Docker won't send a dedicated change item, so we
    // simply omit them from the diff. We'll still add their children though.
    element.appendChild(node.Element);
  }

  // By default, append child nodes to the same root element.
  let parentElement = element;
  if (node.Hidden && node.TotalNodes > 0) {
    // If this node is hidden, append its children to a collapsed <div> instead.
    parentElement = document.createElement('div');
    parentElement.classList.add('collapse');
    // Add a link to reveal hidden child nodes.
    const a = document.createElement('a');
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
  const sortedPaths = Object.keys(node.Children).sort();
  for (let i = 0; i < sortedPaths.length; i++) {
    const path = sortedPaths[i];
    exportDiffTree(parentElement, node.Children[path]);
  }
}
