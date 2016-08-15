// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

var db = require('./db');
var log = require('./log');


// Set a value for a metric.

function set (object, metric, value) {

  var data = object.data;

  if (!data) {
    data = object.data = {};
  }

  data[metric] = value;
  db.save();

}

exports.set = set;


// Push a value into a metric array.

function push (object, metric, value) {

  var data = object.data;

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

  var time = Date.now();
  var data = {
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

  var data = {
    users: [],
    waitlist: []
  };

  var users = db.get('users');
  for (var email in users) {
    data.users.push([ users[email].data.joined ]);
  }
  data.users.sort();

  var waitlist = db.get('waitlist');
  for (var email in waitlist) {
    data.waitlist.push([ waitlist[email] ]);
  }
  data.waitlist.sort();

  return data;

}

exports.getUserData = getUserData;


// Get metrics about all projects.

function getProjectData () {

  var data = [];
  var projects = db.get('projects');

  for (var projectId in projects) {
    var project = projects[projectId];
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

  var data = {
    'new': 0,
    'build-failed': 0,
    'built': 0,
    'start-failed': 0,
    'started': 0,
    'merged': 0
  };
  var users = db.get('users');

  for (var email in users) {
    var machines = users[email].machines;

    for (var projectId in machines) {
      machines[projectId].forEach(function (machine) {
        data[machine.status]++;
      });
    }
  }

  var total = 0;
  for (var status in data) {
    total += data[status];
  }
  data.total = total;

  return data;

}

exports.getContributionData = getContributionData;


// Get metrics about all connected Docker hosts.

function getHostData () {

  var data = {
    docker: []
  };
  var hosts = db.get('dockers');

  for (var host in hosts) {
    data.docker.push({});
  }

  return data;

}

exports.getHostData = getHostData;
