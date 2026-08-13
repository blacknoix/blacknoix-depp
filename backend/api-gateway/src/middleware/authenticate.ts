import type { NextFunction, Request, RequestHandler, Response } from "express";

import { type AuthStrategy, InvalidCredentialError } from "../auth/principal";

/**
 * Resolves the authenticated principal for a request.
 *
 * Runs globally and never rejects, so unauthenticated infrastructure routes
 * (/ and /health) keep working while the request logger can still attach
 * tenantId to any request that carries a principal.
 *
 * Enforcement is the guard's job: see requireTenant, applied per-route at the
 * mount point so that "this route requires a tenant" stays explicit.
 *
 * A credential that fails verification is recorded on the request as
 * `authFailed` rather than rejected here, which keeps the "never rejects"
 * property (a bad token aimed at /health is still just a health check) while
 * giving every guarded route the information it needs to answer 401 instead of
 * treating the caller as anonymous. `authFailed` is set before `principal` is
 * ever assigned, so a failed verification can never leave a stale principal
 * behind.
 */
export function authenticate(strategy: AuthStrategy): RequestHandler {
  return function authenticateRequest(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): void {
    let principal;

    try {
      principal = strategy.authenticate(req);
    } catch (err) {
      if (err instanceof InvalidCredentialError) {
        req.authFailed = true;
        req.principal = undefined;
        next();
        return;
      }

      next(err);
      return;
    }

    if (principal) {
      req.principal = principal;
    }

    next();
  };
}
