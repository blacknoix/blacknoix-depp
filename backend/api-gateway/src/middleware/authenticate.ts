import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AccessTokenPayload, AuthenticatedRequest, UserRole } from '../types/auth';

const JWT_VERIFY_OPTIONS: jwt.VerifyOptions = {
  algorithms: ['HS256'],
};

const VALID_ROLES: UserRole[] = ['owner', 'admin', 'analyst', 'read-only'];

function isUserRole(role: unknown): role is UserRole {
  return typeof role === 'string' && VALID_ROLES.includes(role as UserRole);
}

/**
 * Verifies the Bearer access token and attaches auth context to the request.
 * Responds 401 on any failure — missing, malformed, expired, or wrong secret.
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  let payload: AccessTokenPayload;
  try {
    payload = jwt.verify(token, env.jwt.accessSecret, JWT_VERIFY_OPTIONS) as AccessTokenPayload;
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  if (!payload.tenantId || !payload.sub || !isUserRole(payload.role)) {
    res.status(401).json({ error: 'Malformed token payload' });
    return;
  }

  (req as AuthenticatedRequest).auth = {
    userId: payload.sub,
    tenantId: payload.tenantId,
    role: payload.role,
  };

  next();
}
