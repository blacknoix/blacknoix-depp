import type { NextFunction, Request, Response } from "express";
import { AppError } from "./error-handler";

const TENANT_HEADER = "x-tenant-id";

/**
 * Interim validation.
 *
 * ADR-0001 specifies tenant IDs are UUIDs, resolved into the Postgres runtime
 * setting `app.current_tenant` for RLS. Until Postgres lands, tenant IDs are
 * treated as opaque bounded identifiers so local development can use readable
 * values such as "tenant-dev-001".
 *
 * TODO(depp): tighten to UUID validation when Postgres/RLS is introduced, and
 * replace the header with a verified claim once auth exists. See ADR-0001.
 */
const MAX_TENANT_ID_LENGTH = 64;
const SAFE_TENANT_ID = /^[A-Za-z0-9_-]+$/;

function normalizeTenantId(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_TENANT_ID_LENGTH ||
    !SAFE_TENANT_ID.test(trimmed)
  ) {
    return undefined;
  }

  return trimmed;
}

/**
 * Reads tenant identity from the request and attaches it when valid.
 *
 * Runs globally and never rejects, so unauthenticated infrastructure routes
 * (/ and /health) keep working while the request logger can still attach
 * tenantId to any request that carries one.
 *
 * SECURITY: this header is client-supplied and entirely unverified. It is a
 * development stand-in only. Tenant identity must come from an authenticated
 * principal before this service handles real tenant data.
 */
export function attachTenantContext(req: Request, _res: Response, next: NextFunction): void {
  const tenantId = normalizeTenantId(req.get(TENANT_HEADER));

  if (tenantId) {
    req.tenantId = tenantId;
  }

  next();
}

/**
 * Guard for tenant-scoped routes. Applied at the router mount point so that
 * "this route requires a tenant" is explicit and greppable, rather than an
 * implicit property of global middleware.
 */
export function requireTenant(req: Request, _res: Response, next: NextFunction): void {
  if (!req.tenantId) {
    next(new AppError("TENANT_REQUIRED", 400, "x-tenant-id header is required"));
    return;
  }

  next();
}
