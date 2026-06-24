import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types/auth';
import { TenantScopedRequest } from '../types/tenant';
import { getTenantContext } from '../lib/tenantScope';

/**
 * Ensures authenticate has attached a tenant-scoped auth context and
 * exposes it as req.tenant for handlers and services.
 *
 * Must run after authenticate. Responds 401 if tenant context is missing.
 */
export function requireTenantContext(req: Request, res: Response, next: NextFunction): void {
  const authReq = req as AuthenticatedRequest;
  const { tenantId, userId, role } = authReq.auth ?? {};

  if (!tenantId || !userId || !role) {
    res.status(401).json({ error: 'Tenant context required' });
    return;
  }

  (req as TenantScopedRequest).tenant = getTenantContext(authReq);
  next();
}
