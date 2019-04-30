// Copyright © 2016 Team Janitor. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

// During the 'install' phase, set up our new Service Worker.

self.addEventListener('install', function (event) {
  // After this phase, don't wait for currently open clients to close, jump
  // straight to the 'activate' phase.
  event.waitUntil(self.skipWaiting());
});

// During the 'activate' phase, clean up behind older Service Workers.

self.addEventListener('activate', function (event) {
  // Take control of any currently open clients.
  event.waitUntil(self.clients.claim());
});
