import { Request } from 'express';
import { AuthenticatedRequest } from '../types/auth';
import { TenantContext, TenantOwned, TenantScopedRequest } from '../types/tenant';

/**
 * Build tenant context from an authenticated request.
 * Call only after authenticate middleware has run.
 */
export function getTenantContext(req: AuthenticatedRequest): TenantContext {
  return {
    tenantId: req.auth.tenantId,
    userId: req.auth.userId,
    role: req.auth.role,
  };
}

/**
 * Read tenant context from a request that passed tenantScoped middleware.
 * Cast through unknown because Express route param generics do not include auth/tenant.
 */
export function readTenantFromRequest(req: Request): TenantContext {
  return (req as unknown as TenantScopedRequest).tenant;
}

/** Prisma `where` fragment — always AND this into tenant-owned queries. */
export function tenantWhere(tenantId: string): { tenantId: string } {
  return { tenantId };
}

/** Prisma `where` for a tenant-owned row looked up by primary key. */
export function tenantOwnedWhere(tenantId: string, id: string): { id: string; tenantId: string } {
  return { id, tenantId };
}

/**
 * Merge caller-supplied create data with the authenticated tenant id.
 * Prevents routes from accidentally creating rows in another tenant.
 */
export function withTenantId<T extends Record<string, unknown>>(
  tenantId: string,
  data: T
): T & { tenantId: string } {
  return { ...data, tenantId };
}

/**
 * After fetching a resource by id, verify it belongs to the caller's tenant.
 * Returns false when the resource is missing or owned by another tenant.
 * Services should map a false result to 404 — never 403 — to avoid leaking existence.
 */
export function belongsToTenant(resource: TenantOwned | null | undefined, tenantId: string): boolean {
  return resource?.tenantId === tenantId;
}

/**
 * Reject a URL/path tenant id that does not match the token.
 * Use when routes expose :tenantId explicitly (e.g. /tenants/:tenantId/...).
 */
export function tenantParamMatches(authTenantId: string, paramTenantId: string): boolean {
  return authTenantId === paramTenantId;
}
