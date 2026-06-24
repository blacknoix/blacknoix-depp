import { Request, Response, NextFunction, RequestHandler } from 'express';
import { readTenantFromRequest } from '../lib/tenantScope';
import { UserRole } from '../types/auth';

const ROLE_RANK: Record<UserRole, number> = {
  owner: 4,
  admin: 3,
  analyst: 2,
  'read-only': 1,
};

/**
 * RBAC guard — caller role must meet or exceed the minimum.
 * Must run after tenantScoped middleware.
 */
export function requireRole(minimum: UserRole): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { role } = readTenantFromRequest(req);

    if (ROLE_RANK[role] < ROLE_RANK[minimum]) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    next();
  };
}
