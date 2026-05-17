/** ESLint config for Node / NestJS apps */
module.exports = {
  extends: ['./index.js'],
  env: { node: true, es2022: true },
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
  },
};
