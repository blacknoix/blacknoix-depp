import dotenv from "dotenv";

import { resolveAuthMode } from "../auth/auth-mode";
import { applyExplicitRolesModeFromEnv } from "../auth/roles";

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

// Explicit-role migration mode (ADR-0011). Invalid values stop startup.
// AUTH_MODE=jwt requires an explicit mode (not inferred from NODE_ENV).
// Applied at import so request paths see the same mode before listen().
const explicitRolesMode = applyExplicitRolesModeFromEnv(
  process.env.AUTH_EXPLICIT_ROLES_MODE,
  { requireExplicit: authMode === "jwt" },
);

/**
 * Max events per POST /v1/telemetry/events/batch.
 * Unset → 50. Invalid / out of range fails closed at startup.
 */
export function resolveTelemetryBatchMaxEvents(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") {
    return 50;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error(
      "Invalid TELEMETRY_BATCH_MAX_EVENTS: must be an integer from 1 to 100.",
    );
  }

  return value;
}

/**
 * CORRELATION_BRIDGE_ENABLED — global gate for submitFromDetection (ADR-0005).
 * Unset / empty → true (bridge on). When false, bridge is off for all tenants.
 */
export function resolveCorrelationBridgeEnabled(
  raw: string | undefined,
): boolean {
  if (raw === undefined || raw.trim() === "") {
    return true;
  }
  const normalized = raw.trim().toLowerCase();
  if (
    normalized === "0" ||
    normalized === "false" ||
    normalized === "off" ||
    normalized === "no"
  ) {
    return false;
  }
  if (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "on" ||
    normalized === "yes"
  ) {
    return true;
  }
  throw new Error(
    "Invalid CORRELATION_BRIDGE_ENABLED: use true/false (or 1/0, on/off).",
  );
}

const TENANT_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * CORRELATION_BRIDGE_DISABLED_TENANTS — comma-separated tenant UUIDs for which
 * the bridge fallback is disabled while signed correlation remains available.
 * Only applies when CORRELATION_BRIDGE_ENABLED is true. Unset / empty → none.
 */
export function resolveCorrelationBridgeDisabledTenants(
  raw: string | undefined,
): ReadonlySet<string> {
  if (raw === undefined || raw.trim() === "") {
    return new Set();
  }

  const ids = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  for (const id of ids) {
    if (!TENANT_UUID_RE.test(id)) {
      throw new Error(
        `Invalid CORRELATION_BRIDGE_DISABLED_TENANTS: "${id}" is not a UUID.`,
      );
    }
  }

  return new Set(ids);
}

/**
 * Effective bridge enablement for one tenant (global ∧ ¬tenant-disabled).
 */
export function isCorrelationBridgeEnabledForTenant(
  globalEnabled: boolean,
  disabledTenants: ReadonlySet<string>,
  tenantId: string,
): boolean {
  if (!globalEnabled) {
    return false;
  }
  return !disabledTenants.has(tenantId);
}

export const env = {
  nodeEnv,
  port,
  appName: process.env.APP_NAME ?? "depp-api-gateway",
  authMode,
  /** compat | enforce — see ADR-0011. Unset defaults to compat unless AUTH_MODE=jwt. */
  explicitRolesMode,

  // Left undefined when unset: createApp() owns the default so there is only
  // one place to change it. An invalid value fails closed — body-parser throws
  // at construction, so the service will not start.
  jsonBodyLimit: process.env.BODY_LIMIT_DEFAULT,

  // Undefined when unset. The service starts and serves without a database;
  // /health reports it as not configured. See ADR-0004.
  databaseUrl: resolveDatabaseUrl(process.env.DATABASE_URL),

  telemetryBatchMaxEvents: resolveTelemetryBatchMaxEvents(
    process.env.TELEMETRY_BATCH_MAX_EVENTS,
  ),

  correlationBridgeEnabled: resolveCorrelationBridgeEnabled(
    process.env.CORRELATION_BRIDGE_ENABLED,
  ),

  correlationBridgeDisabledTenants: resolveCorrelationBridgeDisabledTenants(
    process.env.CORRELATION_BRIDGE_DISABLED_TENANTS,
  ),
};
