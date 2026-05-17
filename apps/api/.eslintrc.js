module.exports = {
  root: true,
  extends: ['@pilotage/eslint-config/node'],
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
};
