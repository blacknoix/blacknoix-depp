/**
 * Env for integration tests — mirrors unit setup.ts DATABASE_URL convention.
 * Lives outside src/__tests__/ so the unit Jest config never loads this file.
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/depp_test';
process.env.NODE_ENV = 'test';
