// Copyright © 2015 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

var db = require('./db');
var machines = require('./machines');


// Redirect a query to a target url.

function redirect (query, url) {

  var response = query.res;

  response.statusCode = 302;
  response.setHeader('Location', url);
  response.end();

}

exports.redirect = redirect;


// Public landing page.

function landingPage (user, end) {

  var title = '';

  machines.getProjects(function (error, projects) {

    end({
      machines: user ? machines.getAvailableMachines(user) : null,
      projects: projects,
      title: title,
      user: user,
      scripts: [
        '/js/landing.js',
        '/js/projects.js'
      ]
    }, { template: [
      '../templates/header.html',
      '../templates/landing.html',
      '../templates/projects.html',
      '../templates/footer.html'
    ]});

  });

}

exports.landingPage = landingPage;


// Projects page.

function projectsPage (user, end) {

  var title = 'Projects';

  machines.getProjects(function (error, projects) {

    end({
      machines: user ? machines.getAvailableMachines(user) : null,
      projects: projects,
      title: title,
      user: user,
      scripts: [
        '/js/projects.js'
      ]
    }, { template: [
      '../templates/header.html',
      '../templates/projects.html',
      '../templates/footer.html'
    ]});

  });

}

exports.projectsPage = projectsPage;


// User login page.

function loginPage (end) {

  var title = 'Sign In';

  end({
    title: title,
    user: null,
    scripts: [
      '/js/login.js'
    ]
  }, { template: [
    '../templates/header.html',
    '../templates/login.html',
    '../templates/footer.html'
  ]});

}

exports.loginPage = loginPage;


// User contributions list.

function contributionsPage (user, end) {

  var title = 'My Contributions';

  machines.getProjects(function (error, projects) {

    end({
      projects: projects,
      title: title,
      user: user,
      scripts: []
    }, { template: [
      '../templates/header.html',
      '../templates/contributions.html',
      '../templates/footer.html'
    ]});

  });

}

exports.contributionsPage = contributionsPage;


// User account page.

function accountPage (user, end) {

  var title = 'My Account';

  end({
    title: title,
    user: user,
    scripts: [
      '/js/account.js'
    ]
  }, { template: [
    '../templates/header.html',
    '../templates/account.html',
    '../templates/footer.html'
  ]});

}

exports.accountPage = accountPage;


// Admin page.

function adminPage (user, end) {

  var title = 'Admin';
  var users = db.get('users');
  var waitlist = db.get('waitlist');

  machines.getProjects(function (error, projects) {

    end({
      projects: projects,
      title: title,
      user: user,
      users: users,
      waitlist: waitlist,
      scripts: [
        '/js/admin.js'
      ]
    }, { template: [
      '../templates/header.html',
      '../templates/admin.html',
      '../templates/footer.html'
    ]});

  });

}

exports.adminPage = adminPage;


// 404 Not Found page.

function notFoundPage (user, end) {

  var title = 'Page not found!';

  end({
    title: title,
    user: user,
    scripts: []
  }, { template: [
    '../templates/header.html',
    '../templates/404.html',
    '../templates/footer.html'
  ]});

}

exports.notFoundPage = notFoundPage;
