import dotenv from "dotenv";

import { resolveAuthMode } from "../auth/auth-mode";

// quiet: true suppresses dotenv's startup banner, which it writes to stdout via
// console.log. Left on, it interleaves free text with our structured JSON log
// stream and breaks line-oriented log parsers.
dotenv.config({ quiet: true });

const port = Number(process.env.PORT ?? 3000);

if (Number.isNaN(port) || port <= 0) {
  throw new Error("Invalid PORT value");
}

/**
 * DATABASE_URL is optional in this slice: no route depends on the database yet,
 * so an unset value must leave existing behaviour untouched. A value that is
 * present but malformed still stops startup — configuring it wrongly is an
 * error, configuring it not at all is not.
 *
 * Empty string is treated as unset, because .env.example ships `DATABASE_URL=`.
 *
 * Never log this value: it carries the password.
 */
function resolveDatabaseUrl(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return undefined;
  }

  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Invalid DATABASE_URL: value is not a valid URL.");
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(
      `Invalid DATABASE_URL: expected a postgres:// or postgresql:// URL, got "${parsed.protocol}//".`,
    );
  }

  return trimmed;
}

const nodeEnv = process.env.NODE_ENV ?? "development";

// Throws on an unrecognised mode, or on an unverified mode in production.
// Evaluated at import time so the service fails to start rather than serving
// requests with weaker authentication than intended.
const authMode = resolveAuthMode(process.env.AUTH_MODE, nodeEnv);

export const env = {
  nodeEnv,
  port,
  appName: process.env.APP_NAME ?? "depp-api-gateway",
  authMode,

  // Left undefined when unset: createApp() owns the default so there is only
  // one place to change it. An invalid value fails closed — body-parser throws
  // at construction, so the service will not start.
  jsonBodyLimit: process.env.BODY_LIMIT_DEFAULT,

  // Undefined when unset. The service starts and serves without a database;
  // /health reports it as not configured. See ADR-0004.
  databaseUrl: resolveDatabaseUrl(process.env.DATABASE_URL),
};
