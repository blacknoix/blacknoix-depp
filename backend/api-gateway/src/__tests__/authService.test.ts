import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { logAuthEvent } from '../lib/authAudit';
import { refresh, logout } from '../services/authService';

jest.mock('../lib/authAudit', () => ({
  logAuthEvent: jest.fn(),
  hashClientIp: jest.fn(),
}));

const mockedLogAuthEvent = logAuthEvent as jest.MockedFunction<typeof logAuthEvent>;

const mockFindUnique = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockUpdateMany = jest.fn();
const mockTransaction = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
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

const user = {
  id: 'user-1',
  tenantId: 'tenant-1',
  role: 'analyst',
  email: 'user@example.com',
  passwordHash: 'hash',
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeRefreshJwt(jti: string, overrides?: Partial<{ sub: string; tenantId: string }>) {
  return jwt.sign(
    { sub: 'user-1', tenantId: 'tenant-1', jti, ...overrides },
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
    user: { ...user, tenant: { id: user.tenantId, name: 'Tenant', createdAt: new Date(), updatedAt: new Date() } },
  };
}

beforeEach(() => {
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

describe('authService.refresh rotation', () => {
  it('revokes the old refresh token and issues a new pair', async () => {
    const oldJti = 'old-session-id';
    const token = makeRefreshJwt(oldJti);

    mockFindUnique.mockResolvedValue(activeStoredToken(oldJti));

    const result = await refresh(token);

    expect(result).not.toBeNull();
    expect(mockTransaction).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: oldJti },
      data: { isRevoked: true },
    });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: user.id }),
      })
    );

    const newPayload = jwt.verify(result!.refreshToken, REFRESH_SECRET) as { jti: string };
    expect(newPayload.jti).not.toBe(oldJti);
    expect(jwt.verify(result!.accessToken, ACCESS_SECRET)).toBeTruthy();

    expect(mockedLogAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'refresh', outcome: 'success', userId: user.id })
    );
    expect(mockedLogAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'session_revoked', reason: 'rotated', jti: oldJti })
    );
  });
});

describe('authService.refresh reuse detection', () => {
  it('revokes all user sessions when a revoked token is reused', async () => {
    const jti = 'reused-session-id';
    const token = makeRefreshJwt(jti);

    mockFindUnique.mockResolvedValue(activeStoredToken(jti, true));

    const result = await refresh(token);

    expect(result).toBeNull();
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { userId: user.id, isRevoked: false },
      data: { isRevoked: true },
    });
    expect(mockTransaction).not.toHaveBeenCalled();

    expect(mockedLogAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'refresh_reuse_detected', jti: jti })
    );
    expect(mockedLogAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'session_revoked_all', userId: user.id })
    );
  });
});

describe('authService.logout', () => {
  it('revokes an active refresh session', async () => {
    const jti = 'logout-session-id';
    const token = makeRefreshJwt(jti);

    mockFindUnique.mockResolvedValue(activeStoredToken(jti));

    const ok = await logout(token);

    expect(ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: jti },
      data: { isRevoked: true },
    });

    expect(mockedLogAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'logout', outcome: 'success', jti })
    );
    expect(mockedLogAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'session_revoked', reason: 'logout', jti })
    );
  });

  it('is idempotent for an already-revoked session', async () => {
    const jti = 'revoked-session-id';
    const token = makeRefreshJwt(jti);

    mockFindUnique.mockResolvedValue(activeStoredToken(jti, true));

    const ok = await logout(token);

    expect(ok).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns false for an invalid token', async () => {
    const ok = await logout('not-a-jwt');
    expect(ok).toBe(false);
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockedLogAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'logout_failed', reason: 'invalid_token' })
    );
  });
});

describe('logout then refresh fails', () => {
  it('denies refresh after the session was logged out', async () => {
    const jti = 'session-after-logout';
    const token = makeRefreshJwt(jti);

    mockFindUnique.mockResolvedValue(activeStoredToken(jti));
    await logout(token);

    mockFindUnique.mockResolvedValue(activeStoredToken(jti, true));
    const result = await refresh(token);

    expect(result).toBeNull();
    expect(mockUpdateMany).toHaveBeenCalled();
  });
});
