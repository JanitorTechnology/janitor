// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.


// Spawn a project-specific machine when its link is clicked.

Array.map(document.querySelectorAll('a[data-action="spawn"]'), function (link) {

  link.addEventListener('click', Scout.send(function (query) {
    query.action = link.dataset.action;
    query.data = {
      id: link.dataset.id
    };
    query.resp = function (data) {
      document.location = '/contributions/';
    };
  }));

});
