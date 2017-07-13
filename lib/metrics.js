// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

let db = require('./db');
let log = require('./log');

// Set a value for a metric.

exports.set = function (object, metric, value) {
  let data = object.data;

  if (!data) {
    data = object.data = {};
  }

  data[metric] = value;
  db.save();
};

// Push a value into a metric array.

exports.push = function (object, metric, value) {
  let data = object.data;

  if (!data || !data[metric]) {
    exports.set(object, metric, []);
    data = object.data;
  }

  data[metric].push(value);
  db.save();
};

// Get all available metrics.

exports.get = function (callback) {
  let time = Date.now();
  let data = {
    users: exports.getUserData(),
    projects: exports.getProjectData(),
    contributions: exports.getContributionData(),
    hosts: exports.getHostData()
  };

  callback(data);
  log('data collection took', Date.now() - time, 'ms.');
};

// Get metrics about all users.

exports.getUserData = function () {
  let data = {
    users: [],
    waitlist: []
  };

  let users = db.get('users');
  for (let email in users) {
    data.users.push([ users[email].data.joined ]);
  }
  data.users.sort();

  let waitlist = db.get('waitlist');
  for (let email in waitlist) {
    data.waitlist.push([ waitlist[email] ]);
  }
  data.waitlist.sort();

  return data;
};

// Get metrics about all projects.

exports.getProjectData = function () {
  let data = [];
  let projects = db.get('projects');

  for (let projectId in projects) {
    let project = projects[projectId];
    data.push({
      project: projectId,
      data: project.data
    });
  }

  return data;
};

// Get metrics about all contributions.

exports.getContributionData = function () {
  let data = {
    'new': 0,
    'build-failed': 0,
    'built': 0,
    'start-failed': 0,
    'started': 0,
    'merged': 0
  };
  let users = db.get('users');

  for (let email in users) {
    let machines = users[email].machines;

    for (let projectId in machines) {
      machines[projectId].forEach(function (machine) {
        data[machine.status]++;
      });
    }
  }

  let total = 0;
  for (let status in data) {
    total += data[status];
  }
  data.total = total;

  return data;
};

// Get metrics about all connected Docker hosts.

exports.getHostData = function () {
  let data = {
    docker: []
  };
  let hosts = db.get('hosts');

  // eslint-disable-next-line no-unused-vars
  for (let hostname in hosts) {
    data.docker.push({});
  }

  return data;
};
