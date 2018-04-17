let store = {};

exports.get = function (key, defaultValue) {
  if (!store[key]) {
    store[key] = defaultValue || {};
  }

  return store[key];
};

exports.save = () => {};

exports.__setData = newStore => {
  store = Object.assign({}, newStore);
};
