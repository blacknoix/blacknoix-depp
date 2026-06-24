import { AuthenticatedRequest } from './auth';
import { UserRole } from './auth';

/** Resolved tenant + caller identity from a validated access token. */
export interface TenantContext {
  tenantId: string;
  userId: string;
  role: UserRole;
}

/**
 * Express Request after authenticate + requireTenantContext middleware.
 * `tenant` is the canonical source for tenant-scoped handlers.
 */
export interface TenantScopedRequest extends AuthenticatedRequest {
  tenant: TenantContext;
}

/** Prisma models that belong to exactly one tenant. */
export interface TenantOwned {
  tenantId: string;
}
