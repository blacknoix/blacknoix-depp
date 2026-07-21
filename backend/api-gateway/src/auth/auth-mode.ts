import type { AuthStrategy } from "./principal";
import { devHeaderStrategy } from "./strategies/dev-header";

/**
 * Every authentication mode the service can run in.
 *
 * Only implemented modes appear here. An unrecognised AUTH_MODE is rejected
 * rather than falling back to a default, so a typo cannot silently downgrade
 * authentication.
 */
export const AUTH_MODES = ["dev-header"] as const;

export type AuthMode = (typeof AUTH_MODES)[number];

const DEFAULT_AUTH_MODE: AuthMode = "dev-header";

/**
 * Modes that perform no verification and must never run in production.
 */
const UNVERIFIED_MODES: readonly AuthMode[] = ["dev-header"];

function isAuthMode(value: string): value is AuthMode {
  return (AUTH_MODES as readonly string[]).includes(value);
}

/**
 * Validates AUTH_MODE against the environment, throwing on any unsafe or
 * unrecognised combination.
 *
 * Pure and exported so the guard can be tested directly rather than by
 * spawning processes.
 *
 * Note that dev-header is currently the only implemented mode and is banned in
 * production, so the service cannot start with NODE_ENV=production at all.
 * That is intentional: there is no production-safe authentication yet, and
 * refusing to boot is the honest outcome.
 */
export function resolveAuthMode(
  rawMode: string | undefined,
  nodeEnv: string,
): AuthMode {
  const mode = (rawMode ?? DEFAULT_AUTH_MODE).trim();

  if (!isAuthMode(mode)) {
    throw new Error(
      `Invalid AUTH_MODE "${mode}". Supported modes: ${AUTH_MODES.join(", ")}.`,
    );
  }

  if (nodeEnv === "production" && UNVERIFIED_MODES.includes(mode)) {
    throw new Error(
      `AUTH_MODE "${mode}" cannot be used when NODE_ENV=production. ` +
        "It trusts the unverified client-supplied x-tenant-id header and is a " +
        "development stand-in only.",
    );
  }

  return mode;
}

const STRATEGIES: Record<AuthMode, AuthStrategy> = {
  "dev-header": devHeaderStrategy,
};

export function strategyForMode(mode: AuthMode): AuthStrategy {
  return STRATEGIES[mode];
}
