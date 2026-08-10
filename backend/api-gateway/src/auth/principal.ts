import type { Request } from "express";

/**
 * The authenticated caller for a request.
 *
 * Field names follow the tenant-owned entities in ADR-0001 (users, roles,
 * user_roles). Expect this to gain claims — issuer, expiry, session id — when a
 * verified strategy replaces the development stand-in.
 *
 * `userId` and `roles` are optional because the only strategy available today
 * cannot establish them. A verified strategy must populate them.
 *
 * `roles` (when present) is an allow-listed set such as `operator` / `auditor`.
 * Empty/missing roles are operator-equivalent only in
 * AUTH_EXPLICIT_ROLES_MODE=compat; enforce denies them (ADR-0011). See
 * `auth/roles.ts`.
 */
export interface AuthenticatedPrincipal {
  readonly tenantId: string;
  readonly userId?: string;
  /** The DEPP session this request was authenticated under, when known. */
  readonly sessionId?: string;
  /**
   * Set when the caller authenticated as an agent (machine identity).
   * Telemetry ingest requires this; human JWTs omit it.
   */
  readonly agentId?: string;
  readonly roles?: readonly string[];
}

/**
 * How a request is turned into a principal.
 *
 * Deliberately narrow: one method, synchronous, returning undefined when the
 * request carries no usable credential. Rejecting is the authorization layer's
 * job, not the strategy's.
 *
 * A strategy that needs I/O (JWKS fetch, token introspection) will require
 * widening the return type to allow a promise, and awaiting it in
 * middleware/authenticate.ts. That is a deliberate future change, not an
 * oversight.
 */
export interface AuthStrategy {
  /** Stable identifier, surfaced in startup logs. */
  readonly name: string;

  authenticate(req: Request): AuthenticatedPrincipal | undefined;
}
