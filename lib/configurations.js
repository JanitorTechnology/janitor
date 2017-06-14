// Copyright © 2017 Jan Keromnes, Tim Nguyen. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

'use strict';

const fleau = require('fleau');
const fs = require('fs');

const db = require('./db');
const log = require('./log');

exports.defaults = {};
load();

// Read and pre-compile the default configuration templates.
function load() {
  const path = './templates/configurations/';
  fs.readdir(path, (error, files) => {
    if (error) {
      log('[fail] could not read configurations template directory', error);
    }

    files.forEach(configuration => {
      fs.readFile(path + configuration, 'utf8', (error, template) => {
        if (error) {
          log('[fail] could not load configuration template:',
            configuration, error);
          return;
        }

        exports.defaults[configuration] = fleau.create(template);
      });
    });
  });
}

// Reset a user configuration to its default template value.
exports.resetToDefault = function (user, configuration, callback) {
  if (!exports.defaults[configuration]) {
    callback(new Error(`[fail] no default configuration for ${configuration}`));
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
};
