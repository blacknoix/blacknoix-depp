import { Request } from 'express';

export type UserRole = 'owner' | 'admin' | 'analyst' | 'read-only';

/** Shape of the JWT access token payload. */
export interface AccessTokenPayload {
  sub: string;      // userId
  tenantId: string;
  role: UserRole;
  /** iat / exp added by jsonwebtoken */
}

/** Shape of the JWT refresh token payload. */
export interface RefreshTokenPayload {
  sub: string;      // userId
  tenantId: string;
  jti: string;      // RefreshToken.id in DB — used for revocation lookup
}

/** Express Request augmented after authenticate middleware runs. */
export interface AuthenticatedRequest extends Request {
  auth: {
    userId: string;
    tenantId: string;
    role: UserRole;
  };
}
