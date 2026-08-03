/** ESLint flat config for Node / NestJS packages. */
const globals = require('globals');

const base = require('./base');

module.exports = [
  ...base,
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.es2022 },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // Specs assert on shapes the runtime types cannot express, and they log.
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts', '**/test/**/*.ts'],
    languageOptions: { globals: { ...globals.jest } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
];
