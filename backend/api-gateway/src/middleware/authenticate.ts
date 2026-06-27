import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { hashClientIp, logAuthEvent } from '../lib/authAudit';
import { recordUnauthorized } from '../lib/metrics';
import { AccessTokenPayload, AuthenticatedRequest, UserRole } from '../types/auth';

const JWT_VERIFY_OPTIONS: jwt.VerifyOptions = {
  algorithms: ['HS256'],
};

const VALID_ROLES: UserRole[] = ['owner', 'admin', 'analyst', 'read-only'];

function isUserRole(role: unknown): role is UserRole {
  return typeof role === 'string' && VALID_ROLES.includes(role as UserRole);
}

function denyInvalidToken(req: Request, res: Response, reason: string): void {
  logAuthEvent({
    action: 'access_denied_invalid_token',
    outcome: 'denied',
    httpStatus: 401,
    route: req.path,
    method: req.method,
    reason,
    clientIpHash: hashClientIp(req),
  });
  recordUnauthorized();
  res.status(401).json({ error: reason === 'missing_header' ? 'Missing or malformed Authorization header' : reason === 'malformed_payload' ? 'Malformed token payload' : 'Invalid or expired token' });
}

/**
 * Verifies the Bearer access token and attaches auth context to the request.
 * Responds 401 on any failure — missing, malformed, expired, or wrong secret.
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    denyInvalidToken(req, res, 'missing_header');
    return;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    denyInvalidToken(req, res, 'missing_header');
    return;
  }

  let payload: AccessTokenPayload;
  try {
    payload = jwt.verify(token, env.jwt.accessSecret, JWT_VERIFY_OPTIONS) as AccessTokenPayload;
  } catch {
    denyInvalidToken(req, res, 'invalid_or_expired_token');
    return;
  }

  if (!payload.tenantId || !payload.sub || !isUserRole(payload.role)) {
    denyInvalidToken(req, res, 'malformed_payload');
    return;
  }

  (req as AuthenticatedRequest).auth = {
    userId: payload.sub,
    tenantId: payload.tenantId,
    role: payload.role,
  };

  next();
}
