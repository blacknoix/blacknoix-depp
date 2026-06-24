/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/src/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@prisma/client$': '<rootDir>/src/__tests__/__mocks__/prismaClient.ts',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          strict: true,
          esModuleInterop: true,
          module: 'commonjs',
          target: 'ES2020',
        },
      },
    ],
  },
  setupFiles: ['./src/__tests__/setup.ts'],
};
