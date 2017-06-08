// Copyright © 2017 Jan Keromnes, Tim Nguyen. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

'use strict';

const fleau = require('fleau');
const fs = require('fs');

const db = require('./db');
const log = require('./log');

exports.defaults = {};

load();

function load() {
  const path = './templates/configurations/';
  fs.readdir(path, (error, files) => {
    files.forEach(configuration => {
      fs.readFile(path + configuration, "utf8", (error, template) => {
        exports.defaults[configuration] = fleau.create(template);
      });
    });
  });
}

exports.resetToDefault = function (user, configuration, callback) {
  if (!exports.defaults[configuration]) {
    callback(new Error(`[fail] default configuration for ${configuration} does not exist.`));
    return;
  }
  const stream = exports.defaults[configuration]({ user });
  let content = '';
  stream.on('data', chunk => content += chunk);
  stream.on('end', () => {
    user.configurations[configuration] = content;
    db.save();
    callback();
  });
}