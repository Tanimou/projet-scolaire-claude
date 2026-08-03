module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  // `prisma/` porte le garde-fou de seed (S-E02-4) : il vit à côté des scripts
  // qu'il protège, donc sa preuve doit être exécutée par la même commande.
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/prisma/**/*.spec.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/**/*.module.ts'],
};
