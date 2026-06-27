import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../app';
import * as authService from '../services/authService';
import { logAuthRouteDenied } from '../lib/authRouteAudit';

// ─── Mock authService with a factory so Jest never loads the real module.
// The real module imports @prisma/client which requires a full npm install.
jest.mock('../services/authService', () => ({
  login: jest.fn(),
  refresh: jest.fn(),
  logout: jest.fn(),
  hashPassword: jest.fn(),
}));

jest.mock('../lib/authRouteAudit', () => ({
  logAuthRouteDenied: jest.fn(),
}));

const mockedLogAuthRouteDenied = logAuthRouteDenied as jest.MockedFunction<typeof logAuthRouteDenied>;

const mockedLogin = authService.login as jest.MockedFunction<typeof authService.login>;
const mockedRefresh = authService.refresh as jest.MockedFunction<typeof authService.refresh>;
const mockedLogout = authService.logout as jest.MockedFunction<typeof authService.logout>;

const app = createApp();

const VALID_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET!;

function makeAccessToken(overrides?: Partial<{ sub: string; tenantId: string; role: string }>) {
  return jwt.sign(
    { sub: 'user-1', tenantId: 'tenant-1', role: 'analyst', ...overrides },
    VALID_ACCESS_SECRET,
    { expiresIn: '15m' }
  );
}

// ─── POST /auth/login ─────────────────────────────────────────────────────────
describe('POST /auth/login', () => {
  beforeEach(() => jest.clearAllMocks());

  it('200 + token pair on valid credentials', async () => {
    mockedLogin.mockResolvedValue({
      accessToken: 'access-tok',
      refreshToken: 'refresh-tok',
    });

    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'user@example.com', password: 'correct-password' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ accessToken: expect.any(String), refreshToken: expect.any(String) });
    expect(mockedLogin).toHaveBeenCalledWith('user@example.com', 'correct-password');
  });

  it('401 on wrong password', async () => {
    mockedLogin.mockResolvedValue(null);

    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'user@example.com', password: 'wrong' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  it('401 on unknown email (same error shape — no enumeration)', async () => {
    mockedLogin.mockResolvedValue(null);

    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'nobody@example.com', password: 'anything' });

    expect(res.status).toBe(401);
    // Error message must NOT reveal whether the user exists
    expect(res.body.error).not.toMatch(/not found|unknown user|no user/i);
  });

  it('400 when body fields are missing', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'user@example.com' }); // no password

    expect(res.status).toBe(400);
    expect(res.body.fields).toContain('password');
  });

  it('400 when email format is invalid', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'not-an-email', password: 'pw' });

    expect(res.status).toBe(400);
    expect(res.body.fields).toContain('email');
    expect(mockedLogin).not.toHaveBeenCalled();
  });

  it('400 when password exceeds max length', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'user@example.com', password: 'x'.repeat(129) });

    expect(res.status).toBe(400);
    expect(res.body.fields).toContain('password');
    expect(mockedLogin).not.toHaveBeenCalled();
  });

  it('lowercases and trims email before lookup', async () => {
    mockedLogin.mockResolvedValue(null);

    await request(app)
      .post('/auth/login')
      .send({ email: '  USER@Example.COM  ', password: 'pw' });

    expect(mockedLogin).toHaveBeenCalledWith('user@example.com', 'pw');
  });
});

// ─── POST /auth/refresh ───────────────────────────────────────────────────────
describe('POST /auth/refresh', () => {
  beforeEach(() => jest.clearAllMocks());

  it('200 + new token pair on valid refresh token', async () => {
    mockedRefresh.mockResolvedValue({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    });

    const res = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: 'valid-refresh-token' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ accessToken: 'new-access', refreshToken: 'new-refresh' });
  });

  it('401 on expired or revoked refresh token', async () => {
    mockedRefresh.mockResolvedValue(null);

    const res = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: 'expired-or-revoked' });

    expect(res.status).toBe(401);
  });

  it('400 when refreshToken field is missing', async () => {
    const res = await request(app)
      .post('/auth/refresh')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.fields).toContain('refreshToken');
  });

  it('400 when refreshToken is empty', async () => {
    const res = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: '   ' });

    expect(res.status).toBe(400);
    expect(mockedRefresh).not.toHaveBeenCalled();
  });
});

// ─── POST /auth/logout ────────────────────────────────────────────────────────
describe('POST /auth/logout', () => {
  beforeEach(() => jest.clearAllMocks());

  it('204 when logout succeeds', async () => {
    mockedLogout.mockResolvedValue(true);

    const res = await request(app)
      .post('/auth/logout')
      .send({ refreshToken: 'valid-refresh-token' });

    expect(res.status).toBe(204);
    expect(mockedLogout).toHaveBeenCalledWith('valid-refresh-token');
  });

  it('401 when refresh token is invalid', async () => {
    mockedLogout.mockResolvedValue(false);

    const res = await request(app)
      .post('/auth/logout')
      .send({ refreshToken: 'invalid-token' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid or expired refresh token');
  });

  it('401 after logout when refresh is attempted', async () => {
    mockedLogout.mockResolvedValue(true);
    mockedRefresh.mockResolvedValue(null);

    await request(app)
      .post('/auth/logout')
      .send({ refreshToken: 'session-token' });

    const res = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: 'session-token' });

    expect(res.status).toBe(401);
    expect(mockedRefresh).toHaveBeenCalledWith('session-token');
  });

  it('400 when refreshToken is missing', async () => {
    const res = await request(app).post('/auth/logout').send({});
    expect(res.status).toBe(400);
    expect(mockedLogout).not.toHaveBeenCalled();
  });
});

// ─── GET /auth/me (authenticate middleware) ───────────────────────────────────
describe('GET /auth/me', () => {
  it('200 + identity when valid access token provided', async () => {
    const token = makeAccessToken({ sub: 'user-1', tenantId: 'tenant-1', role: 'analyst' });

    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ userId: 'user-1', tenantId: 'tenant-1', role: 'analyst' });
  });

  it('401 when Authorization header is missing', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });

  it('401 when Authorization header is not Bearer', async () => {
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', 'Basic abc123');

    expect(res.status).toBe(401);
  });

  it('401 on tampered token', async () => {
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', 'Bearer totally.fake.token');

    expect(res.status).toBe(401);
  });

  it('401 on token signed with wrong secret', async () => {
    const badToken = jwt.sign(
      { sub: 'user-1', tenantId: 'tenant-1', role: 'analyst' },
      'wrong-secret',
      { expiresIn: '15m' }
    );

    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${badToken}`);

    expect(res.status).toBe(401);
  });

  it('401 on token missing tenantId', async () => {
    const token = jwt.sign(
      { sub: 'user-1', role: 'analyst' }, // deliberately no tenantId
      VALID_ACCESS_SECRET,
      { expiresIn: '15m', algorithm: 'HS256' }
    );

    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });

  it('401 on token with invalid role claim', async () => {
    const token = jwt.sign(
      { sub: 'user-1', tenantId: 'tenant-1', role: 'superadmin' },
      VALID_ACCESS_SECRET,
      { expiresIn: '15m', algorithm: 'HS256' }
    );

    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });

  it('401 on empty Bearer token', async () => {
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', 'Bearer ');

    expect(res.status).toBe(401);
  });
});

// ─── Cross-tenant isolation ───────────────────────────────────────────────────
describe('Tenant isolation', () => {
  it('token from tenant-A does not expose tenant-B identity', async () => {
    const tokenA = makeAccessToken({ sub: 'user-a', tenantId: 'tenant-A' });

    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.tenantId).toBe('tenant-A');
    // Future tenant-scoped routes must enforce: req.auth.tenantId === resource.tenantId
  });
});

// ─── Auth route audit logging ─────────────────────────────────────────────────
describe('auth route audit logging', () => {
  beforeEach(() => jest.clearAllMocks());

  it('logs validation failure on login 400 without password values', async () => {
    await request(app)
      .post('/auth/login')
      .send({ email: 'user@example.com' });

    expect(mockedLogAuthRouteDenied).toHaveBeenCalledWith(
      expect.anything(),
      400,
      expect.any(String),
      expect.arrayContaining(['password'])
    );
    const [, , reason, fields] = mockedLogAuthRouteDenied.mock.calls[0]!;
    expect(reason).not.toMatch(/secret|password/i);
    expect(fields).toEqual(expect.arrayContaining(['password']));
  });

  it('logs 401 on failed login without credential values', async () => {
    mockedLogin.mockResolvedValue(null);

    await request(app)
      .post('/auth/login')
      .send({ email: 'user@example.com', password: 'wrong-password' });

    expect(mockedLogAuthRouteDenied).toHaveBeenCalledWith(
      expect.anything(),
      401,
      'invalid_credentials'
    );
    const [, status, reason] = mockedLogAuthRouteDenied.mock.calls[0]!;
    expect(status).toBe(401);
    expect(reason).toBe('invalid_credentials');
    expect(reason).not.toContain('wrong-password');
  });
});
