const db = require('./db');
const log = require('./log');
let taskCounter = 0; // Used to generate unique task IDs

exports.tasks = db.get('tasks');
exports.taskTypes = new Map();

exports.check = function () {
  const now = Date.now();
  for (const task of Object.values(exports.tasks)) {
    if (now > Number(task.date)) {
      exports.execute(task);
    }
  }
};

exports.addType = function (type, task) {
  if (exports.taskTypes.has(type)) {
    throw new Error('[fail] task', task, 'already exists');
  }

  exports.taskTypes.set(type, task);
};

exports.add = function (date, type, data) {
  taskCounter++;

  const msSince1970 = date.getTime();
  const taskId = `${type}-${msSince1970}-${taskCounter}`;

  const task = {
    id: taskId,
    date: msSince1970,
    type,
    data,
  };

  exports.tasks[taskId] = task;
  db.save();
  return task;
};

exports.remove = function (id) {
  delete exports.tasks[id];
  db.save();
};

exports.execute = function ({ type, data, id }) {
  const task = exports.taskTypes.get(type);
  log('[ok] Task', id, 'executed', data);
  task(data);
  exports.remove(id);
};
