module.exports = {
  "env": {
    "browser": true,
    "es6": false
  },
  "extends": [
    "eslint:recommended",
    "standard"
  ],
  "globals": {
    "$": true,
    "Dygraph": true,
    "Scout": true,
    "ajaxForm": true,
    "timeago": true,
    "updateFormStatus": true,
  },
  "rules": {
    // Override some of standard js rules.
    "semi": ["error", "always"],
    "comma-dangle": [
      "error", {
        "arrays": "only-multiline",
        "objects": "only-multiline",
        "imports": "never",
        "exports": "never",
        "functions": "never",
      }
    ],

    // Override some eslint base rules because we're using ES5.
    "no-new": "off",

    // Custom rules.
    "no-console": ["error", {"allow": ["warn", "error"]}],
  }
};