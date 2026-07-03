/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/integration/**/*.integration.test.ts'],
  // No moduleNameMapper — loads the real @prisma/client from node_modules.
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.integration.json',
      },
    ],
  },
  setupFiles: ['<rootDir>/integration/setup.ts'],
  globalSetup: '<rootDir>/integration/globalSetup.ts',
  testTimeout: 30_000,
};
