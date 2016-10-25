// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

let db = require('./db');
let log = require('./log');


// Set a value for a metric.

function set (object, metric, value) {

  let data = object.data;

  if (!data) {
    data = object.data = {};
  }

  data[metric] = value;
  db.save();

}

exports.set = set;


// Push a value into a metric array.

function push (object, metric, value) {

  let data = object.data;

  if (!data || !data[metric]) {
    set(object, metric, []);
    data = object.data;
  }

  data[metric].push(value);
  db.save();

}

exports.push = push;


// Get all available metrics.

function get (callback) {

  let time = Date.now();
  let data = {
    users: getUserData(),
    projects: getProjectData(),
    contributions: getContributionData(),
    hosts: getHostData()
  };

  callback(data);
  log('data collection took', Date.now() - time, 'ms.');

}

exports.get = get;


// Get metrics about all users.

function getUserData () {

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

}

exports.getUserData = getUserData;


// Get metrics about all projects.

function getProjectData () {

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

}

exports.getProjectData = getProjectData;


// Get metrics about all contributions.

function getContributionData () {

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

}

exports.getContributionData = getContributionData;


// Get metrics about all connected Docker hosts.

function getHostData () {

  let data = {
    docker: []
  };
  let hosts = db.get('hosts');

  for (let hostname in hosts) {
    data.docker.push({});
  }

  return data;

}

exports.getHostData = getHostData;
