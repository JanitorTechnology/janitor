// Copyright © 2017 Team Janitor. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

'use strict';

const fleau = require('fleau');
const fs = require('fs');
const nodePath = require('path');

const db = require('./db');
const log = require('./log');

const templatesDirectory = './templates/configurations';

exports.allowed = [
  '.config/hub',
  '.ssh/authorized_keys',
  '.arcrc',
  '.emacs',
  '.eslintrc',
  '.gdbinit',
  '.gitconfig',
  '.gitignore',
  '.hgrc',
  '.nanorc',
  '.netrc',
  '.vimrc',
];
exports.defaults = {};
load();

// Read and pre-compile all default configuration templates.
function load (subDirectory = '') {
  const directory = nodePath.join(templatesDirectory, subDirectory);
  // List all template files and sub-directories in this directory.
  fs.readdir(directory, (error, fileNames) => {
    if (error) {
      log('[fail] could not read directory:', directory, error);
      return;
    }

    fileNames.forEach(fileName => {
      const file = nodePath.join(subDirectory, fileName);
      const path = nodePath.join(templatesDirectory, file);
      fs.readFile(path, 'utf8', (error, content) => {
        if (error) {
          if (error.code === 'EISDIR') {
            // This file is a sub-directory, load its own files recursively.
            load(file);
            return;
          }

          log('[fail] could not read configuration template:', file, error);
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
