# Janitor

[![Github Actions](https://github.com/JanitorTechnology/janitor/workflows/CI/badge.svg?branch=master)](https://github.com/JanitorTechnology/janitor/actions?query=workflow%3ACI+branch%3Amaster)
[![Docker Hub](https://img.shields.io/docker/build/janitortechnology/janitor.svg)](https://hub.docker.com/r/janitortechnology/janitor/)
[![Greenkeeper](https://img.shields.io/badge/greenkeeper-enabled-brightgreen.svg)](https://greenkeeper.io/)
[![NPM version](https://img.shields.io/npm/v/janitor.technology.svg)](https://www.npmjs.com/package/janitor.technology)
[![NPM dependencies](https://img.shields.io/david/JanitorTechnology/janitor.svg)](https://david-dm.org/JanitorTechnology/janitor)
[![IRC channel](https://img.shields.io/badge/%23janitor-on%20freenode-brightgreen.svg)](https://kiwiirc.com/client/irc.freenode.net/?#janitor "irc.freenode.net#janitor")

*Fix bugs, faster*

[![Janitor video](https://j.gifs.com/m89qbk.gif)](http://www.youtube.com/watch?v=5sNDMIh-iVw "Coding Firefox directly in the Web (using Cloud9 and Janitor)")

## Try it live

Sign in to [janitor.technology](https://janitor.technology).

## Try it at home

Install [Node.js](https://nodejs.org) (version 8 minimum) (and optionally [Docker](https://www.docker.com)).

Clone this repository:

    git clone https://github.com/janitortechnology/janitor
    cd janitor/

Install dependencies:

    npm install

Configure `./db.json` for a local use or simply download the following [configuration](https://raw.githubusercontent.com/JanitorTechnology/dockerfiles/master/janitor/db.json).

Start the server:

    node app

Then hit [https://localhost:1443](https://localhost:1443/)!

## Hack it

You can hack Janitor directly [on Janitor](https://janitor.technology/projects/)!

Check your code:

    npm run lint

Auto-fix your code:

    npm run lint-fix

Test your code:

    npm test

Auto-restart the server when its files are modified:

    npm run watch

Run the server in the background (use `tail -f janitor.log` to check on it):

    npm run app

## Help wanted!

- If you find bugs, please open [issues](https://github.com/janitortechnology/janitor/issues).
- To suggest changes, please open [pull requests](https://help.github.com/articles/using-pull-requests/).
- For general questions, please ask on [Discourse](https://discourse.janitor.technology/) or [IRC](https://kiwiirc.com/client/irc.freenode.net/?#janitor "irc.freenode.net#janitor").

## Thanks

- [IRILL](http://www.irill.org/) and [Mozilla](https://www.mozilla.org/) for hosting this project.
- [Datadog](https://www.datadoghq.com/) for monitoring the health and performance of our servers.
- [Cloud9](https://c9.io/) for sponsoring alpha accounts.
