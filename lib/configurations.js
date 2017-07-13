// Copyright © 2017 Jan Keromnes, Tim Nguyen. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

'use strict';

const fleau = require('fleau');
const fs = require('fs');

const db = require('./db');
const log = require('./log');

exports.allowed = [
  '.config/hub',
  '.emacs',
  '.eslintrc',
  '.gdbinit',
  '.gitconfig',
  '.gitignore',
  '.hgrc',
  '.nanorc',
  '.netrc',
  '.ssh/config',
  '.vimrc',
];
exports.defaults = {};
load();

// Read and pre-compile the default configuration templates.
function load () {
  const directory = './templates/configurations/';
  fs.readdir(directory, (error, files) => {
    if (error) {
      log('[fail] could not read configurations template directory:',
        directory, error);
      return;
    }

    files.forEach(file => {
      fs.readFile(directory + file, 'utf8', (error, content) => {
        if (error) {
          log('[fail] could not load configuration template:', file, error);
          return;
        }

        try {
          exports.defaults[file] = fleau.create(content);
        } catch (error) {
          log('[fail] could not create fleau template for:', file, error);
        }
      });
    });
  });
}

// Reset a user configuration to its default template value.
exports.resetToDefault = function (user, file, callback) {
  const template = exports.defaults[file];
  if (!template) {
    callback(new Error('No default configuration for: ' + file));
    return;
  }

  let stream = null;
  try {
    stream = template({ user });
  } catch (error) {
    log('[fail] fleau templating error with:', file, error);
    callback(new Error('Could not run fleau template for: ' + file));
    return;
  }

  let content = '';
  stream.on('data', chunk => { content += String(chunk); });
  stream.on('end', () => {
    user.configurations[file] = content;
    db.save();
    callback();
  });
};
