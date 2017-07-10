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
    "comma-dangle": [
      "error", {
        "arrays": "only-multiline",
        "objects": "only-multiline",
        "imports": "never",
        "exports": "never",
        "functions": "never",
      }
    ],
    
    // Override some eslint base rules because we're using node.
    "no-console": "off",
  }
};