// Copyright © 2018 Team Janitor. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const EventEmitter = require('events');

// Note: If you miss an important scheduling feature here, maybe import a "real"
//   cron-based scheduler module instead of reimplementing one.
// For example: https://github.com/IMA-WorldHealth/TaskList

const db = require('./db');
const log = require('./log');

const schedulingInterval = 1000 * 60 * 60 * 10; // Every 10 hours.

const emitter = new EventEmitter();
const events = db.get('events');
load();

// Load past and upcoming events from the database.
function load () {
  emitter.on('error', error => {
    log('[fail] event emitter error', error);
  });

  if (!events.history) {
    events.history = [];
  }

  if (!events.queue) {
    events.queue = [];
  }

  // Events should flow through the following states:
  // 1. Queued: `event` is added to `events.queue`
  // 2. Scheduled: `event.scheduledTime` is set
  // 3. Emitted: `event.emittedTime` is set, and `event` is moved from
  //   `events.queue` to `events.history`

  // Remove any empty event slots (already emitted).
  events.queue = events.queue.filter(event => !!event);

  // Re-schedule any un-emitted events.
  events.queue.forEach(event => { event.scheduledTime = null; });
}

// Start regularly scheduling events.
exports.startScheduling = function () {
  setTimeout(processQueue, 0);
};

// Get all previously emitted events.
exports.get = function () {
  return events.history;
};

// Get the queue of upcoming events.
exports.getQueue = function () {
  return events.queue
    .filter(event => !!event) // Remove any empty event slots (already emitted).
    .sort((a, b) => b.dueTime - a.dueTime); // Sort the queue by due date.
};

// Register a new event listener.
exports.on = function (eventType, listener) {
  emitter.on(eventType, listener);
};

// Register a single-use event listener.
exports.once = function (eventType, listener) {
  emitter.once(eventType, listener);
};

// Emit an event now.
exports.emit = function (eventType, payload = null) {
  exports.emitAtTime(eventType, Date.now(), payload);
};

// Emit an event at a certain due date (a timestamp).
exports.emitAtTime = function (eventType, dueTime, payload = null) {
  const event = createEvent(eventType, dueTime, payload);
  events.queue.push(event);
  maybeSchedule(event);
};

// Process all upcoming events, and schedule any events that are due soon.
// Note: We schedule events at regular intervals instead of just using
//   `setTimeout` directly, because `setTimeout` has a maximum range of about
//   24 days, which is not enough for our needs.
// See: https://nodejs.org/api/timers.html#timers_settimeout_callback_delay_args
function processQueue () {
  log('processing event queue');
  events.queue.forEach(maybeSchedule);
  setTimeout(processQueue, schedulingInterval);
}

// Emit or schedule an event if it's due soon.
function maybeSchedule (event) {
  if (!event || event.scheduledTime) {
    // Already emitted or scheduled, nothing to do.
    return;
  }

  const now = Date.now();
  if (event.dueTime - now >= schedulingInterval) {
    // The event is not due yet, schedule it later.
    return;
  }

  // The event is due soon, schedule it now.
  event.scheduledTime = now;
  if (event.dueTime <= now) {
    // It's due or past due, emit it now.
    setTimeout(() => { emitEvent(event); }, 0);
  } else {
    // It's due soon, emit it before the next queue processing takes place.
    setTimeout(() => { emitEvent(event); }, event.dueTime - now);
  }
}

// Emit an event now.
function emitEvent (event) {
  event.consumed = emitter.emit(event.type, event.payload);
  event.emittedTime = Date.now();
  if (!event.consumed) {
    const error = new Error('No listeners for event type: ' + event.type);
    log('[fail] lost event', event.type, event.payload, error);
  }

  // Remove the emitted event from the queue.
  const index = events.queue.indexOf(event);
  if (index > -1) {
    // Note: We don't use `.splice()`, to keep indexes stable during iteration.
    events.queue[index] = null;
  }

  events.history.push(event);
  db.save();
}

// Create a new event to be emitted at a given timestamp.
function createEvent (type, dueTime, payload = null) {
  return {
    type,
    payload,
    dueTime,
    scheduledTime: null,
    emittedTime: null,
    consumed: false
  };
}
