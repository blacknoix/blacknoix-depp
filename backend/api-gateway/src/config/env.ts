/**
 * Typed environment configuration.
 * Fails fast at startup if any required variable is missing.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function requireSecret(name: string): string {
  const value = requireEnv(name);
  if (value.length < 32) {
    throw new Error(`${name} must be at least 32 characters`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export const env = {
  databaseUrl: requireEnv('DATABASE_URL'),

  jwt: {
    accessSecret: requireSecret('JWT_ACCESS_SECRET'),
    refreshSecret: requireSecret('JWT_REFRESH_SECRET'),
    accessExpiresIn: optional('JWT_ACCESS_EXPIRES_IN', '15m'),
    refreshExpiresIn: optional('JWT_REFRESH_EXPIRES_IN', '7d'),
  },

  authRateLimit: {
    windowMs: optionalInt('AUTH_RATE_LIMIT_WINDOW_MS', 60_000),
    max: optionalInt('AUTH_RATE_LIMIT_MAX', 20),
  },

  ipHashSalt: optional('IP_HASH_SALT', ''),

  port: parseInt(optional('PORT', '3001'), 10),
  nodeEnv: optional('NODE_ENV', 'development'),
} as const;
