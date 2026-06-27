import { Request, Response, NextFunction } from 'express';
import { hashClientIp, logAuthEvent } from '../lib/authAudit';
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
    logAuthEvent({
      action: 'access_denied_missing_tenant_context',
      outcome: 'denied',
      httpStatus: 401,
      route: req.path,
      method: req.method,
      reason: 'tenant_context_required',
      clientIpHash: hashClientIp(req),
    });
    res.status(401).json({ error: 'Tenant context required' });
    return;
  }

  (req as TenantScopedRequest).tenant = getTenantContext(authReq);
  next();
}
