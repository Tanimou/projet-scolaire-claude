module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  moduleNameMapper: {
    // S-E04-4 — same reason as `apps/api/jest.config.js`: `test-ratchet.js`
    // spawns jest directly with `cwd: appDir`, so turbo's `test → ^build` never
    // runs here and `@pilotage/contracts` would resolve to a git-ignored
    // `dist/` built before this commit. Tests read the SOURCE; the shipped
    // worker image still requires the built package (ADR-037 D5).
    '^@pilotage/contracts$': '<rootDir>/../../packages/contracts/src/index.ts',
    '^@pilotage/contracts/(.*)$': '<rootDir>/../../packages/contracts/src/$1',
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/**/*.module.ts'],
};
