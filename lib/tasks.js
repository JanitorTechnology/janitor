/*
  Tasks are pending actions stored in the database.
  A task is described by 3 different properties:
    - The task type, which can be registered with a function accepting some 
      arguments and a callback (executor)
    - The timestamp, which indicates when the task should execute
    - The arguments to be executed with the task executor
*/

const db = require('./db');
const log = require('./log');
let taskCounter = 0; // Used to generate unique task IDs

const tasks = db.get('tasks');
const taskTypes = new Map();

exports.check = function () {
  // Tasks are executed in the order they are added
  const now = Date.now();
  for (const task of Object.values(tasks)) {
    if (Number(task.date) < now) {
      execute(task);
    }
  }
};

exports.addType = function (type, task) {
  if (taskTypes.has(type)) {
    throw new Error(`[fail] task ${task} already exists`);
  }

  taskTypes.set(type, task);
};

exports.add = function (date, type, data) {
  taskCounter++;

  const timestamp = date.getTime();
  const taskId = `${type}-${timestamp}-${taskCounter}`;

  const task = {
    id: taskId,
    date: timestamp,
    type,
    data,
  };

  tasks[taskId] = task;
  db.save();
  return task;
};

exports.remove = function (id) {
  delete tasks[id];
  db.save();
};

function execute ({ type, data, id }) {
  const taskExecutor = taskTypes.get(type);
  log('[ok] Task', id, 'executed', data);

  // Tasks may also add new tasks
  taskExecutor(data, (error) => {
    if (!error) {
      exports.remove(id);
    }
  });
}
