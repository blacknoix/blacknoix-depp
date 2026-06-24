import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types/auth';
import { tenantParamMatches } from '../lib/tenantScope';

/**
 * Rejects requests where a route param tenant id does not match the token.
 * Returns 403 — the caller explicitly targeted another tenant's namespace.
 *
 * @param paramName - route param to compare (default: tenantId)
 */
export function requireMatchingTenantParam(paramName = 'tenantId') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authReq = req as AuthenticatedRequest;
    const paramTenantId = req.params[paramName];

    if (!paramTenantId) {
      res.status(400).json({ error: `Missing route parameter: ${paramName}` });
      return;
    }

    if (!tenantParamMatches(authReq.auth.tenantId, paramTenantId)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    next();
  };
}
