/**
 * Env for integration tests — mirrors unit setup.ts DATABASE_URL convention.
 * Lives outside src/__tests__/ so the unit Jest config never loads this file.
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/depp_test';
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET ?? 'test-access-secret-at-least-32-chars-long';
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET ?? 'test-refresh-secret-at-least-32-chars-long';
process.env.NODE_ENV = 'test';
