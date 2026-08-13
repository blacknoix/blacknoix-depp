import type { AuthenticatedPrincipal } from "../auth/principal";

/**
 * Express request augmentation for DEPP api-gateway.
 *
 * `requestId` is guaranteed to be set by the requestId middleware, which is
 * registered first in the middleware chain. It is declared non-optional so
 * downstream code does not need to null-check it.
 *
 * `principal` is optional: it is only populated when the configured auth
 * strategy resolves a credential. Tenant-scoped routes must use the
 * requireTenant guard rather than assuming this value exists.
 *
 * `authFailed` is set when the request presented a credential that failed
 * verification. It is NOT the negation of `principal`: an anonymous request has
 * neither, while a forged-token request has `authFailed` and no principal.
 * Guards must check it first so invalid credentials answer 401 rather than the
 * 400 used for a missing tenant.
 */
declare global {
  namespace Express {
    interface Request {
      requestId: string;
      principal?: AuthenticatedPrincipal;
      authFailed?: boolean;
    }
  }
}

export {};
