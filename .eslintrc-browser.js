module.exports = {
  "env": {
    "browser": true,
    "es6": false
  },
  "extends": [
    "eslint:recommended",
    "standard"
  ],
  "rules": {
    // Override some of standard js rules.
    "semi": ["error", "always"],
    "comma-dangle": ["error", "never"],
    
    // Override some eslint base rules because we're using ES5.
    "no-new": "off",
    
    // Custom rules.
    "no-console": ["error", {"allow": ["warn", "error"]}],
  }
};