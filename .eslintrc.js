module.exports = {
  'env': {
    'browser': false,
    'es6': true,
    'node': true
  },
  'extends': [
    'eslint:recommended',
    'plugin:node/recommended',
    'standard'
  ],
  'plugins': [
    'node'
  ],
  'rules': {
    // Override some of standard js rules
    'semi': [ 'error', 'always' ],
    'comma-dangle': [ 'error', 'only-multiline' ],
    'camelcase': 'off',
    'no-var': 'error',
    'prefer-const': 'error',
    'arrow-parens': [ 'error', 'as-needed' ],
    'standard/array-bracket-even-spacing': 'off',
    'array-bracket-spacing': [ 'error', 'always', { 'objectsInArrays': false }],
    'object-curly-spacing': [ 'error', 'always' ],

    // Override some eslint base rules because we're using node.
    'no-console': 'off',
  }
};
