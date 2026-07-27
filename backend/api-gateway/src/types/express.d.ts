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
 */
declare global {
  namespace Express {
    interface Request {
      requestId: string;
      principal?: AuthenticatedPrincipal;
    }
  }
}

export {};
