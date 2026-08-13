import type { JwtConfig } from "./jwt/access-token";
import type { AuthStrategy } from "./principal";
import { devHeaderStrategy } from "./strategies/dev-header";
import { createJwtStrategy } from "./strategies/jwt";

/**
 * Every authentication mode the service can run in.
 *
 * Only implemented modes appear here. An unrecognised AUTH_MODE is rejected
 * rather than falling back to a default, so a typo cannot silently downgrade
 * authentication.
 */
export const AUTH_MODES = ["dev-header", "jwt"] as const;

export type AuthMode = (typeof AUTH_MODES)[number];

const DEFAULT_AUTH_MODE: AuthMode = "dev-header";

/**
 * Modes that perform no verification and must never run in production. `jwt`
 * verifies a signature, so it is not listed here and is allowed in production.
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
 * dev-header is banned in production because it verifies nothing. jwt is not,
 * so NODE_ENV=production now boots under AUTH_MODE=jwt. Reaching production
 * still takes more than this guard: jwt additionally requires verified JWT
 * configuration and an explicit AUTH_EXPLICIT_ROLES_MODE, both enforced at
 * startup.
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

export interface AuthStrategyDeps {
  /** Required for the jwt mode; validated at startup by resolveJwtConfig. */
  jwtConfig?: JwtConfig;
}

/**
 * Builds the strategy for a mode. jwt needs verified configuration; if it is
 * missing, this throws rather than returning a strategy that cannot verify,
 * which keeps the failure at startup instead of at request time.
 */
export function createAuthStrategy(
  mode: AuthMode,
  deps: AuthStrategyDeps = {},
): AuthStrategy {
  switch (mode) {
    case "dev-header":
      return devHeaderStrategy;
    case "jwt":
      if (!deps.jwtConfig) {
        throw new Error(
          "AUTH_MODE=jwt requires JWT configuration (JWT_ACCESS_SECRET, JWT_ISSUER, JWT_AUDIENCE).",
        );
      }
      return createJwtStrategy(deps.jwtConfig);
  }
}
