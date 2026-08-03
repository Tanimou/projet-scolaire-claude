const node = require('@pilotage/eslint-config/node');

module.exports = [
  ...node,
  {
    // PF-69: `prisma/` — ~2 900 lines of seed and guard code — was outside both
    // the lint glob (`{src,test}/**/*.ts`) and the typecheck include
    // (`src/**/*`). The seed chain that filled the hosted deployment with demo
    // data (PF-17) lived in the one directory no gate looked at. It is linted
    // now; the console output is the point of a seed script, so only that rule
    // is relaxed.
    files: ['prisma/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
];
