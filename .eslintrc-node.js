module.exports = {
  "env": {
    "browser": false,
    "es6": true,
    "node": true
  },
  "extends": [
    "eslint:recommended",
    "plugin:node/recommended",
    "standard"
  ],
  "plugins": [
    "node"
  ],
  "rules": {
    // Override some of standard js rules
    "semi": ["error", "always"],
    "comma-dangle": ["error", "only-multiline"],
    
    // Override some eslint base rules because we're using node.
    "no-console": "off",
  }
};