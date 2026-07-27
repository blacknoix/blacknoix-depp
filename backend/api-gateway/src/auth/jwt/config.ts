import type { JwtConfig } from "./access-token";

/**
 * Resolves and validates JWT configuration for the `jwt` auth mode.
 *
 * Pure and exported so the fail-closed behaviour can be tested directly rather
 * than by spawning a process. index.ts calls it at startup when AUTH_MODE=jwt,
 * so an invalid or missing configuration stops the service from booting rather
 * than serving requests it cannot verify.
 */

const MIN_SECRET_LENGTH = 32;
const DEFAULT_ACCESS_TTL_SECONDS = 900; // 15 minutes (ADR-0003 §4).
const MAX_ACCESS_TTL_SECONDS = 3600; // Short-lived invariant: at most one hour.

export function resolveJwtConfig(env: Record<string, string | undefined>): JwtConfig {
  const secret = env.JWT_ACCESS_SECRET;
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `AUTH_MODE=jwt requires JWT_ACCESS_SECRET of at least ${MIN_SECRET_LENGTH} characters.`,
    );
  }

  const issuer = env.JWT_ISSUER?.trim();
  if (!issuer) {
    throw new Error("AUTH_MODE=jwt requires JWT_ISSUER.");
  }

  const audience = env.JWT_AUDIENCE?.trim();
  if (!audience) {
    throw new Error("AUTH_MODE=jwt requires JWT_AUDIENCE.");
  }

  let accessTtlSeconds = DEFAULT_ACCESS_TTL_SECONDS;
  const rawTtl = env.JWT_ACCESS_TTL_SECONDS;
  if (rawTtl !== undefined && rawTtl.trim() !== "") {
    accessTtlSeconds = Number(rawTtl);
    if (
      !Number.isInteger(accessTtlSeconds) ||
      accessTtlSeconds <= 0 ||
      accessTtlSeconds > MAX_ACCESS_TTL_SECONDS
    ) {
      throw new Error(
        `JWT_ACCESS_TTL_SECONDS must be an integer between 1 and ${MAX_ACCESS_TTL_SECONDS}.`,
      );
    }
  }

  return { secret, issuer, audience, accessTtlSeconds };
}
