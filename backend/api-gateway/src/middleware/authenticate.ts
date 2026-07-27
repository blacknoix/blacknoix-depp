import type { NextFunction, Request, RequestHandler, Response } from "express";

import type { AuthStrategy } from "../auth/principal";

/**
 * Resolves the authenticated principal for a request.
 *
 * Runs globally and never rejects, so unauthenticated infrastructure routes
 * (/ and /health) keep working while the request logger can still attach
 * tenantId to any request that carries a principal.
 *
 * Enforcement is the guard's job: see requireTenant, applied per-route at the
 * mount point so that "this route requires a tenant" stays explicit.
 */
export function authenticate(strategy: AuthStrategy): RequestHandler {
  return function authenticateRequest(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): void {
    const principal = strategy.authenticate(req);

    if (principal) {
      req.principal = principal;
    }

    next();
  };
}
