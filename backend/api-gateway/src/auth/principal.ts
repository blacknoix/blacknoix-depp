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
 * Raised by a strategy when the request PRESENTS a credential that fails
 * verification — tampered signature, unsupported/`none` algorithm, malformed
 * token, wrong issuer/audience, expired.
 *
 * This is deliberately distinct from returning `undefined`, which means "this
 * request carries no credential at all". Collapsing the two lets an attacker's
 * rejected token be handled as anonymous traffic, so a forged token yields the
 * same response as an unauthenticated one (400 TENANT_REQUIRED) instead of the
 * 401 that RFC 6750 requires for an invalid access token.
 *
 * Carries no token material: `reason` is a fixed internal string, never echoed
 * to the caller and never logged alongside the credential.
 */
export class InvalidCredentialError extends Error {
  constructor(public readonly reason: string = "invalid_token") {
    super("invalid credential");
    this.name = "InvalidCredentialError";
  }
}

/**
 * How a request is turned into a principal.
 *
 * Deliberately narrow: one method, synchronous, returning undefined when the
 * request carries no usable credential. Rejecting is the authorization layer's
 * job, not the strategy's.
 *
 * The one exception is InvalidCredentialError: a strategy MUST throw it rather
 * than return undefined when a credential was supplied and failed verification.
 * The strategy still does not write the response — middleware/authenticate.ts
 * records the failure and the per-route guard rejects — but the distinction has
 * to originate here, because only the strategy knows a credential was offered.
 *
 * A strategy that needs I/O (JWKS fetch, token introspection) will require
 * widening the return type to allow a promise, and awaiting it in
 * middleware/authenticate.ts. That is a deliberate future change, not an
 * oversight.
 */
export interface AuthStrategy {
  /** Stable identifier, surfaced in startup logs. */
  readonly name: string;

  /** @throws InvalidCredentialError when a supplied credential fails verification. */
  authenticate(req: Request): AuthenticatedPrincipal | undefined;
}
