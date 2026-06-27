import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../config/env';
import { logAuthEvent } from '../lib/authAudit';
import {
  recordLoginFailure,
  recordLoginSuccess,
  recordLogoutSuccess,
  recordRefreshFailure,
  recordRefreshReuseDetected,
  recordRefreshSuccess,
} from '../lib/metrics';
import { prisma } from '../lib/prisma';
import { AccessTokenPayload, RefreshTokenPayload, UserRole } from '../types/auth';

const BCRYPT_COST = 12;
const JWT_VERIFY_OPTIONS: jwt.VerifyOptions = { algorithms: ['HS256'] };

type DbClient = {
  refreshToken: Pick<typeof prisma.refreshToken, 'create'>;
};

// Map Prisma's Role enum to our UserRole type
function toUserRole(prismaRole: string): UserRole {
  const map: Record<string, UserRole> = {
    owner: 'owner',
    admin: 'admin',
    analyst: 'analyst',
    read_only: 'read-only',
  };
  return map[prismaRole] ?? 'read-only';
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

function parseRefreshToken(rawRefreshToken: string): RefreshTokenPayload | null {
  try {
    const payload = jwt.verify(
      rawRefreshToken,
      env.jwt.refreshSecret,
      JWT_VERIFY_OPTIONS
    ) as RefreshTokenPayload;
    if (!payload.sub || !payload.tenantId || !payload.jti) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/** Revoke every active refresh session for a user (reuse-detection response). */
async function revokeAllUserSessions(
  userId: string,
  tenantId: string,
  reason: string
): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, isRevoked: false },
    data: { isRevoked: true },
  });

  logAuthEvent({
    action: 'session_revoked_all',
    outcome: 'success',
    userId,
    tenantId,
    reason,
  });
}

/**
 * Validate credentials and return a token pair.
 * Deliberately returns the same error for wrong email and wrong password
 * to prevent user enumeration.
 */
export async function login(email: string, password: string): Promise<TokenPair | null> {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { tenant: true },
  });

  // Always run bcrypt compare to prevent timing attacks on unknown email
  const dummyHash = '$2b$12$invalidhashpaddingtomakethislookupconstanttime000000000';
  const hash = user?.passwordHash ?? dummyHash;
  const valid = await bcrypt.compare(password, hash);

  if (!user || !valid) {
    logAuthEvent({
      action: 'login_failed',
      outcome: 'failure',
      reason: 'invalid_credentials',
    });
    recordLoginFailure();
    return null;
  }

  const pair = await issueTokenPair(user.id, user.tenantId, toUserRole(user.role));

  logAuthEvent({
    action: 'login',
    outcome: 'success',
    userId: user.id,
    tenantId: user.tenantId,
    role: toUserRole(user.role),
    jti: pair.refreshJti,
  });

  recordLoginSuccess();
  return { accessToken: pair.accessToken, refreshToken: pair.refreshToken };
}

/**
 * Validate a refresh token, rotate it, and issue a new pair.
 * Detects reuse of revoked tokens and invalidates all user sessions.
 */
export async function refresh(rawRefreshToken: string): Promise<TokenPair | null> {
  const payload = parseRefreshToken(rawRefreshToken);
  if (!payload) {
    logAuthEvent({
      action: 'refresh_failed',
      outcome: 'failure',
      reason: 'invalid_token',
    });
    recordRefreshFailure();
    return null;
  }

  const stored = await prisma.refreshToken.findUnique({
    where: { id: payload.jti },
    include: { user: true },
  });

  if (!stored) {
    logAuthEvent({
      action: 'refresh_failed',
      outcome: 'failure',
      reason: 'session_not_found',
      jti: payload.jti,
    });
    recordRefreshFailure();
    return null;
  }

  if (stored.userId !== payload.sub || stored.user.tenantId !== payload.tenantId) {
    logAuthEvent({
      action: 'refresh_failed',
      outcome: 'failure',
      reason: 'claim_mismatch',
      userId: stored.userId,
      tenantId: stored.user.tenantId,
      jti: payload.jti,
    });
    recordRefreshFailure();
    return null;
  }

  if (stored.isRevoked) {
    logAuthEvent({
      action: 'refresh_reuse_detected',
      outcome: 'denied',
      userId: stored.userId,
      tenantId: stored.user.tenantId,
      jti: payload.jti,
      reason: 'revoked_token_reused',
    });
    recordRefreshReuseDetected();
    recordRefreshFailure();
    await revokeAllUserSessions(stored.userId, stored.user.tenantId, 'refresh_reuse_detected');
    return null;
  }

  if (stored.expiresAt < new Date()) {
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { isRevoked: true },
    });
    logAuthEvent({
      action: 'session_revoked',
      outcome: 'success',
      userId: stored.userId,
      tenantId: stored.user.tenantId,
      jti: stored.id,
      reason: 'expired',
    });
    logAuthEvent({
      action: 'refresh_failed',
      outcome: 'failure',
      userId: stored.userId,
      tenantId: stored.user.tenantId,
      jti: stored.id,
      reason: 'expired',
    });
    recordRefreshFailure();
    return null;
  }

  const previousJti = stored.id;

  const pair = await prisma.$transaction(async (tx) => {
    await tx.refreshToken.update({
      where: { id: stored.id },
      data: { isRevoked: true },
    });

    return issueTokenPair(
      stored.user.id,
      stored.user.tenantId,
      toUserRole(stored.user.role),
      tx
    );
  });

  logAuthEvent({
    action: 'session_revoked',
    outcome: 'success',
    userId: stored.user.id,
    tenantId: stored.user.tenantId,
    jti: previousJti,
    reason: 'rotated',
  });

  logAuthEvent({
    action: 'refresh',
    outcome: 'success',
    userId: stored.user.id,
    tenantId: stored.user.tenantId,
    role: toUserRole(stored.user.role),
    previousJti,
    jti: pair.refreshJti,
  });

  recordRefreshSuccess();
  return { accessToken: pair.accessToken, refreshToken: pair.refreshToken };
}

/**
 * Revoke the refresh session identified by the token.
 * Idempotent — already-revoked sessions still return true.
 */
export async function logout(rawRefreshToken: string): Promise<boolean> {
  const payload = parseRefreshToken(rawRefreshToken);
  if (!payload) {
    logAuthEvent({
      action: 'logout_failed',
      outcome: 'failure',
      reason: 'invalid_token',
    });
    return false;
  }

  const stored = await prisma.refreshToken.findUnique({
    where: { id: payload.jti },
    include: { user: true },
  });

  if (!stored) {
    logAuthEvent({
      action: 'logout_failed',
      outcome: 'failure',
      reason: 'session_not_found',
      jti: payload.jti,
    });
    return false;
  }

  if (stored.userId !== payload.sub || stored.user.tenantId !== payload.tenantId) {
    logAuthEvent({
      action: 'logout_failed',
      outcome: 'failure',
      reason: 'claim_mismatch',
      userId: stored.userId,
      tenantId: stored.user.tenantId,
      jti: payload.jti,
    });
    return false;
  }

  if (!stored.isRevoked) {
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { isRevoked: true },
    });
    logAuthEvent({
      action: 'session_revoked',
      outcome: 'success',
      userId: stored.userId,
      tenantId: stored.user.tenantId,
      jti: stored.id,
      reason: 'logout',
    });
  }

  logAuthEvent({
    action: 'logout',
    outcome: 'success',
    userId: stored.userId,
    tenantId: stored.user.tenantId,
    jti: stored.id,
  });

  recordLogoutSuccess();
  return true;
}

/**
 * Issue a fresh access + refresh token pair, persisting the refresh token.
 */
async function issueTokenPair(
  userId: string,
  tenantId: string,
  role: UserRole,
  db: DbClient = prisma
): Promise<TokenPair & { refreshJti: string }> {
  const accessPayload: AccessTokenPayload = { sub: userId, tenantId, role };
  const accessToken = jwt.sign(accessPayload, env.jwt.accessSecret, {
    algorithm: 'HS256',
    expiresIn: env.jwt.accessExpiresIn,
  } as jwt.SignOptions);

  const jti = uuidv4();
  const refreshExpiresAt = computeExpiry(env.jwt.refreshExpiresIn);

  await db.refreshToken.create({
    data: {
      id: jti,
      userId,
      expiresAt: refreshExpiresAt,
    },
  });

  const refreshPayload: RefreshTokenPayload = { sub: userId, tenantId, jti };
  const refreshToken = jwt.sign(refreshPayload, env.jwt.refreshSecret, {
    algorithm: 'HS256',
    expiresIn: env.jwt.refreshExpiresIn,
  } as jwt.SignOptions);

  return { accessToken, refreshToken, refreshJti: jti };
}

/**
 * Hash a plaintext password (for seeding / user creation).
 */
export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_COST);
}

/** Convert a duration string like "7d" or "15m" to a future Date. */
function computeExpiry(duration: string): Date {
  const unit = duration.slice(-1);
  const value = parseInt(duration.slice(0, -1), 10);
  const ms =
    unit === 'd' ? value * 86_400_000 :
    unit === 'h' ? value * 3_600_000 :
    unit === 'm' ? value * 60_000 :
    value * 1_000;
  return new Date(Date.now() + ms);
}
