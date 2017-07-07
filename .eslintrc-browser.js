module.exports = {
  "env": {
    "browser": true,
    "es6": false
  },
  "extends": [
    "eslint:recommended",
    "plugin:node/recommended",
    "standard"
  ],
  "parserOptions": {
    "ecmaVersion": "2017",
    "ecmaFeatures": {
      "experimentalObjectRestSpread": true,
      "jsx": true
    },
    "sourceType": "module"
  },
  "plugins": [
    "node"
  ],
  "rules": {
    // Standard js rules
    "semi": ["error", "always"],
    "comma-dangle": ["error", "never"],
    
    // Node require rules
    "node/exports-style": ["error", "module.exports"],

    // overriding recommended rules
    "no-constant-condition": ["error", { checkLoops: false }],
    "no-console": [ "error", { allow: ["log", "warn", "error"] } ],
    "no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],

    // possible errors
    "array-callback-return": "error",
    "consistent-return": "error",
    "default-case": "error",
    "dot-notation": "error",
    "eqeqeq": "error",
    "for-direction": "error",
    "no-alert": "error",
    "no-caller": "error",
    "no-eval": "error",
    "no-extend-native": "error",
    "no-extra-bind": "error",
    "no-extra-label": "error",
    "no-implied-eval": "error",
    "no-invalid-this": "error",
    "no-return-await": "error",
    "no-self-compare": "error",
    "no-throw-literal": "error",
    "no-unmodified-loop-condition": "error",
    "no-unused-expressions": "error",
    "no-useless-call": "error",
    "no-useless-computed-key": "error",
    "no-useless-concat": "error",
    "no-useless-constructor": "error",
    "no-useless-rename": "error",
    "no-useless-return": "error",
    "no-var": "off",
    "no-void": "error",
    "no-with": "error",
    "prefer-const": "error",
    "prefer-promise-reject-errors": "error",
    "prefer-rest-params": "error",
    "prefer-spread": "error",
  }
};