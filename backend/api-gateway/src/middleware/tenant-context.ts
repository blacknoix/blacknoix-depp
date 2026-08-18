import type { NextFunction, Request, Response } from "express";

import type { AuthenticatedPrincipal } from "../auth/principal";
import { AppError } from "./error-handler";

/** RFC 6750 §3 challenge for a presented-but-invalid bearer token. */
const INVALID_TOKEN_CHALLENGE = 'Bearer error="invalid_token"';

/**
 * Rejection for a credential that was supplied and failed verification.
 *
 * Separate from TENANT_REQUIRED because the two are different conditions:
 * "you sent nothing" (400, the caller may simply be missing a header) versus
 * "you sent something and it is not valid" (401, authentication failed). The
 * message is fixed and claim-free so it cannot confirm which check rejected the
 * token.
 */
function invalidCredential(): AppError {
  return new AppError("INVALID_TOKEN", 401, "Authentication credentials are not valid");
}

/**
 * Guard for tenant-scoped routes. Applied at the router mount point so that
 * "this route requires a tenant" is explicit and greppable, rather than an
 * implicit property of global middleware.
 *
 * Checks authFailed before principal: a forged, tampered, alg:none, expired, or
 * otherwise unverifiable token must fail authentication here, before any
 * tenant, role, or route-level authorization runs. Only once no credential was
 * rejected does a missing principal mean "no tenant supplied".
 *
 * The TENANT_REQUIRED message is unchanged from when tenant identity was read
 * directly from the header: under the dev-header strategy a missing principal
 * and a missing x-tenant-id header are the same condition.
 */
export function requireTenant(req: Request, res: Response, next: NextFunction): void {
  if (req.authFailed) {
    res.setHeader("WWW-Authenticate", INVALID_TOKEN_CHALLENGE);
    next(invalidCredential());
    return;
  }

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
 *
 * Mirrors requireTenant's authFailed check so a handler reached without that
 * guard still answers 401 for a rejected credential rather than 400.
 */
export function requirePrincipal(req: Request): AuthenticatedPrincipal {
  if (req.authFailed) {
    throw invalidCredential();
  }

  if (!req.principal) {
    throw new AppError("TENANT_REQUIRED", 400, "x-tenant-id header is required");
  }

  return req.principal;
}
