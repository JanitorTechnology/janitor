// Copyright © 2016 Team Janitor. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const db = require('./db');
const log = require('./log');

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
  const time = Date.now();
  const data = {
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
  const data = {
    users: [],
    waitlist: []
  };

  const users = db.get('users');
  for (const email in users) {
    data.users.push([users[email].data.joined]);
  }
  data.users.sort();

  const waitlist = db.get('waitlist');
  for (const email in waitlist) {
    data.waitlist.push([waitlist[email]]);
  }
  data.waitlist.sort();

  return data;
};

// Get metrics about all projects.

exports.getProjectData = function () {
  const data = [];
  const projects = db.get('projects');

  for (const projectId in projects) {
    const project = projects[projectId];
    data.push({
      project: projectId,
      data: project.data
    });
  }

  return data;
};

// Get metrics about all contributions.

exports.getContributionData = function () {
  const data = {
    new: 0,
    'build-failed': 0,
    built: 0,
    'start-failed': 0,
    started: 0,
    merged: 0
  };
  const users = db.get('users');

  for (const email in users) {
    const machines = users[email].machines;

    for (const projectId in machines) {
      machines[projectId].forEach(function (machine) {
        data[machine.status]++;
      });
    }
  }

  let total = 0;
  for (const status in data) {
    total += data[status];
  }
  data.total = total;

  return data;
};

// Get metrics about all connected Docker hosts.

exports.getHostData = function () {
  const data = {
    docker: []
  };
  const hosts = db.get('hosts');

  // eslint-disable-next-line no-unused-vars
  for (const hostname in hosts) {
    data.docker.push({});
  }

  return data;
};
