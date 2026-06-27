import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { createApp } from '../app';
import {
  getMetricsSnapshot,
  recordLoginFailure,
  recordLoginSuccess,
  recordRefreshFailure,
  recordRefreshReuseDetected,
  recordRefreshSuccess,
  resetMetrics,
} from '../lib/metrics';
import { refresh, logout, login, hashPassword } from '../services/authService';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import {
  createAuthRateLimiter,
  resetAuthRateLimitBuckets,
} from '../middleware/authRateLimit';

const mockFindUnique = jest.fn();
const mockUserFindUnique = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockUpdateMany = jest.fn();
const mockTransaction = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
    refreshToken: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      create: (...args: unknown[]) => mockCreate(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
    },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => mockTransaction(fn),
  },
}));

const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!;
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET!;
const app = createApp();

const user = {
  id: 'user-1',
  tenantId: 'tenant-1',
  role: 'analyst',
  email: 'user@example.com',
  passwordHash: 'hash',
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeAccessToken(role: string) {
  return jwt.sign(
    { sub: 'user-1', tenantId: 'tenant-1', role },
    ACCESS_SECRET,
    { expiresIn: '15m' }
  );
}

function makeRefreshJwt(jti: string) {
  return jwt.sign(
    { sub: 'user-1', tenantId: 'tenant-1', jti },
    REFRESH_SECRET,
    { expiresIn: '7d', algorithm: 'HS256' }
  );
}

function activeStoredToken(jti: string, isRevoked = false) {
  return {
    id: jti,
    userId: user.id,
    isRevoked,
    expiresAt: new Date(Date.now() + 86_400_000),
    createdAt: new Date(),
    user: {
      ...user,
      tenant: { id: user.tenantId, name: 'Tenant', createdAt: new Date(), updatedAt: new Date() },
    },
  };
}

beforeEach(() => {
  resetMetrics();
  resetAuthRateLimitBuckets();
  jest.clearAllMocks();
  mockCreate.mockResolvedValue({});
  mockUpdate.mockResolvedValue({});
  mockUpdateMany.mockResolvedValue({ count: 1 });
  mockTransaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) =>
    fn({
      refreshToken: {
        update: mockUpdate,
        create: mockCreate,
      },
    } as unknown as typeof prisma)
  );
});

describe('metrics counters', () => {
  it('increments individual record functions', () => {
    recordLoginSuccess();
    recordLoginFailure();
    recordRefreshSuccess();
    recordRefreshFailure();
    recordRefreshReuseDetected();

    const snapshot = getMetricsSnapshot();
    expect(snapshot.loginSuccess).toBe(1);
    expect(snapshot.loginFailure).toBe(1);
    expect(snapshot.refreshSuccess).toBe(1);
    expect(snapshot.refreshFailure).toBe(1);
    expect(snapshot.refreshReuseDetected).toBe(1);
    expect(snapshot.collectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('resetMetrics clears all counters', () => {
    recordLoginSuccess();
    resetMetrics();
    expect(getMetricsSnapshot().loginSuccess).toBe(0);
  });
});

describe('authService metrics wiring', () => {
  it('records login failure on invalid credentials', async () => {
    mockUserFindUnique.mockResolvedValue(null);

    const result = await login('user@example.com', 'wrong-password');
    expect(result).toBeNull();
    expect(getMetricsSnapshot().loginFailure).toBe(1);
    expect(getMetricsSnapshot().loginSuccess).toBe(0);
  });

  it('records login success on valid credentials', async () => {
    const passwordHash = await hashPassword('correct-password');
    mockUserFindUnique.mockResolvedValue({
      ...user,
      passwordHash,
      tenant: { id: user.tenantId, name: 'Tenant', createdAt: new Date(), updatedAt: new Date() },
    });

    const result = await login('user@example.com', 'correct-password');
    expect(result).not.toBeNull();
    expect(getMetricsSnapshot().loginSuccess).toBe(1);
    expect(getMetricsSnapshot().loginFailure).toBe(0);
  });

  it('records refresh success on rotation', async () => {
    const jti = 'session-rotate';
    mockFindUnique.mockResolvedValue(activeStoredToken(jti));

    const result = await refresh(makeRefreshJwt(jti));
    expect(result).not.toBeNull();

    const snapshot = getMetricsSnapshot();
    expect(snapshot.refreshSuccess).toBe(1);
    expect(snapshot.refreshFailure).toBe(0);
    expect(snapshot.refreshReuseDetected).toBe(0);
  });

  it('records refresh reuse and failure on revoked token reuse', async () => {
    const jti = 'session-reused';
    mockFindUnique.mockResolvedValue(activeStoredToken(jti, true));

    const result = await refresh(makeRefreshJwt(jti));
    expect(result).toBeNull();

    const snapshot = getMetricsSnapshot();
    expect(snapshot.refreshReuseDetected).toBe(1);
    expect(snapshot.refreshFailure).toBe(1);
    expect(snapshot.refreshSuccess).toBe(0);
  });

  it('records logout success', async () => {
    const jti = 'session-logout';
    mockFindUnique.mockResolvedValue(activeStoredToken(jti));

    const ok = await logout(makeRefreshJwt(jti));
    expect(ok).toBe(true);
    expect(getMetricsSnapshot().logoutSuccess).toBe(1);
  });
});

describe('middleware metrics wiring', () => {
  it('records unauthorized on authenticate 401', () => {
    const req = { headers: {}, path: '/test', method: 'GET', ip: '127.0.0.1', socket: {} } as Request;
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    authenticate(req, res as unknown as Response, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(getMetricsSnapshot().unauthorizedCount).toBe(1);
  });

  it('records forbidden on requireRole 403', () => {
    const req = {
      tenant: { tenantId: 'tenant-1', userId: 'user-1', role: 'read-only' },
      path: '/test',
      method: 'GET',
      ip: '127.0.0.1',
      socket: {},
    } as unknown as Request;
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    requireRole('analyst')(req, res as unknown as Response, jest.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(getMetricsSnapshot().forbiddenCount).toBe(1);
  });

  it('records rate limited on 429', () => {
    const limiter = createAuthRateLimiter(60_000, 1);
    const req = { ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' }, path: '/login', method: 'POST' } as Request;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      setHeader: jest.fn(),
    };

    limiter(req, res as unknown as Response, jest.fn());
    limiter(req, res as unknown as Response, jest.fn());

    expect(res.status).toHaveBeenCalledWith(429);
    expect(getMetricsSnapshot().rateLimitedCount).toBe(1);
  });
});

describe('GET /internal/metrics', () => {
  const expectedKeys = [
    'loginSuccess',
    'loginFailure',
    'refreshSuccess',
    'refreshFailure',
    'refreshReuseDetected',
    'logoutSuccess',
    'unauthorizedCount',
    'forbiddenCount',
    'rateLimitedCount',
    'collectedAt',
  ];

  it('401 without token and increments unauthorizedCount', async () => {
    const res = await request(app).get('/internal/metrics');
    expect(res.status).toBe(401);
    expect(getMetricsSnapshot().unauthorizedCount).toBe(1);
  });

  it('403 for analyst role and increments forbiddenCount', async () => {
    const res = await request(app)
      .get('/internal/metrics')
      .set('Authorization', `Bearer ${makeAccessToken('analyst')}`);

    expect(res.status).toBe(403);
    expect(getMetricsSnapshot().forbiddenCount).toBe(1);
  });

  it('200 + snapshot shape for admin role', async () => {
    recordLoginSuccess();
    recordRefreshReuseDetected();

    const res = await request(app)
      .get('/internal/metrics')
      .set('Authorization', `Bearer ${makeAccessToken('admin')}`);

    expect(res.status).toBe(200);
    for (const key of expectedKeys) {
      expect(res.body).toHaveProperty(key);
    }
    expect(res.body.loginSuccess).toBe(1);
    expect(res.body.refreshReuseDetected).toBe(1);
    expect(typeof res.body.collectedAt).toBe('string');
  });

  it('200 for owner role', async () => {
    const res = await request(app)
      .get('/internal/metrics')
      .set('Authorization', `Bearer ${makeAccessToken('owner')}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('collectedAt');
  });
});
