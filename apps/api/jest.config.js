module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  // `prisma/` porte le garde-fou de seed (S-E02-4) : il vit à côté des scripts
  // qu'il protège, donc sa preuve doit être exécutée par la même commande.
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/prisma/**/*.spec.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // S-E04-4. `@pilotage/contracts` resolves through its `main` to the CJS
    // `dist/`, which is git-ignored and is NOT rebuilt by this runner:
    // `scripts/test-ratchet.js` spawns jest directly with `cwd: appDir`, so
    // turbo's `test → dependsOn ["^build"]` never runs locally. A spec that
    // imported a symbol added to contracts in the same commit would therefore
    // read `undefined` from a dist built before it — green typecheck, TypeError
    // at runtime, and the tempting misdiagnosis is "the new export is wrong".
    // Tests read the SOURCE; runtime consumers keep the package specifier and
    // keep `pnpm --filter @pilotage/contracts build` as a landing prerequisite.
    '^@pilotage/contracts$': '<rootDir>/../../packages/contracts/src/index.ts',
    '^@pilotage/contracts/(.*)$': '<rootDir>/../../packages/contracts/src/$1',
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/**/*.module.ts'],
};
