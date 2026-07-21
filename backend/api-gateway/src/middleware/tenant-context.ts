import type { NextFunction, Request, Response } from "express";

import type { AuthenticatedPrincipal } from "../auth/principal";
import { AppError } from "./error-handler";

/**
 * Guard for tenant-scoped routes. Applied at the router mount point so that
 * "this route requires a tenant" is explicit and greppable, rather than an
 * implicit property of global middleware.
 *
 * The message is unchanged from when tenant identity was read directly from the
 * header: under the dev-header strategy a missing principal and a missing
 * x-tenant-id header are the same condition.
 */
export function requireTenant(req: Request, _res: Response, next: NextFunction): void {
  if (!req.principal) {
    next(new AppError("TENANT_REQUIRED", 400, "x-tenant-id header is required"));
    return;
  }

  next();
}

/**
 * Narrows req.principal for handlers mounted behind requireTenant.
 *
 * req.principal is optional at the type level because most requests do not have
 * one. This keeps route handlers free of non-null assertions while still
 * failing closed if a handler is ever mounted without its guard.
 */
export function requirePrincipal(req: Request): AuthenticatedPrincipal {
  if (!req.principal) {
    throw new AppError("TENANT_REQUIRED", 400, "x-tenant-id header is required");
  }

  return req.principal;
}
