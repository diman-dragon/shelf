import globals from 'globals';
// Run from the project root:  eslint -c tests/eslint.config.mjs www/js www/app.js   (npm run lint in /tests does exactly that)
export default [{
  files: ['**/*.js'],
  languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser, Capacitor: 'readonly', MediaMetadata: 'readonly' } },
  rules: {
    'no-undef': 'error', 'no-redeclare': 'error', 'no-dupe-keys': 'error', 'no-const-assign': 'error', 'no-unsafe-finally': 'error',
    'no-unreachable': 'warn', 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
    'no-empty': ['warn', { allowEmptyCatch: true }]
  }
}];
