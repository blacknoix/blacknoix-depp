import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../app';
import * as tenantService from '../services/tenantService';
import * as userService from '../services/userService';
import {
  belongsToTenant,
  tenantOwnedWhere,
  tenantParamMatches,
  tenantWhere,
  withTenantId,
} from '../lib/tenantScope';

jest.mock('../services/tenantService', () => ({
  getTenantProfile: jest.fn(),
}));

jest.mock('../services/userService', () => ({
  getUserInTenant: jest.fn(),
}));

const mockedGetTenantProfile = tenantService.getTenantProfile as jest.MockedFunction<
  typeof tenantService.getTenantProfile
>;
const mockedGetUserInTenant = userService.getUserInTenant as jest.MockedFunction<
  typeof userService.getUserInTenant
>;

const app = createApp();
const VALID_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET!;

function makeAccessToken(overrides?: Partial<{ sub: string; tenantId: string; role: string }>) {
  return jwt.sign(
    { sub: 'user-a', tenantId: 'tenant-a', role: 'analyst', ...overrides },
    VALID_ACCESS_SECRET,
    { expiresIn: '15m' }
  );
}

// ─── tenantScope helpers ──────────────────────────────────────────────────────
describe('tenantScope helpers', () => {
  it('tenantWhere returns a tenantId filter', () => {
    expect(tenantWhere('tenant-a')).toEqual({ tenantId: 'tenant-a' });
  });

  it('tenantOwnedWhere scopes by id and tenantId', () => {
    expect(tenantOwnedWhere('tenant-a', 'user-1')).toEqual({ id: 'user-1', tenantId: 'tenant-a' });
  });

  it('withTenantId injects tenantId into create payloads', () => {
    expect(withTenantId('tenant-a', { email: 'a@example.com' })).toEqual({
      email: 'a@example.com',
      tenantId: 'tenant-a',
    });
  });

  it('belongsToTenant is true only for matching tenant', () => {
    expect(belongsToTenant({ tenantId: 'tenant-a' }, 'tenant-a')).toBe(true);
    expect(belongsToTenant({ tenantId: 'tenant-b' }, 'tenant-a')).toBe(false);
    expect(belongsToTenant(null, 'tenant-a')).toBe(false);
  });

  it('tenantParamMatches requires exact tenant id match', () => {
    expect(tenantParamMatches('tenant-a', 'tenant-a')).toBe(true);
    expect(tenantParamMatches('tenant-a', 'tenant-b')).toBe(false);
  });
});

// ─── GET /api/tenant ──────────────────────────────────────────────────────────
describe('GET /api/tenant', () => {
  beforeEach(() => jest.clearAllMocks());

  it('200 + tenant profile for authenticated caller', async () => {
    mockedGetTenantProfile.mockResolvedValue({
      id: 'tenant-a',
      name: 'Acme Corp',
      createdAt: new Date('2024-01-01'),
    });

    const res = await request(app)
      .get('/api/tenant')
      .set('Authorization', `Bearer ${makeAccessToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'tenant-a', name: 'Acme Corp' });
    expect(mockedGetTenantProfile).toHaveBeenCalledWith('tenant-a');
  });

  it('401 without Authorization header', async () => {
    const res = await request(app).get('/api/tenant');
    expect(res.status).toBe(401);
    expect(mockedGetTenantProfile).not.toHaveBeenCalled();
  });

  it('401 when token is missing tenantId', async () => {
    const token = jwt.sign({ sub: 'user-a', role: 'analyst' }, VALID_ACCESS_SECRET, {
      expiresIn: '15m',
    });

    const res = await request(app)
      .get('/api/tenant')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(mockedGetTenantProfile).not.toHaveBeenCalled();
  });

  it('404 when tenant profile is not found', async () => {
    mockedGetTenantProfile.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/tenant')
      .set('Authorization', `Bearer ${makeAccessToken()}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Tenant not found');
    expect(mockedGetTenantProfile).toHaveBeenCalledWith('tenant-a');
  });

  it('200 for read-only role', async () => {
    mockedGetTenantProfile.mockResolvedValue({
      id: 'tenant-a',
      name: 'Acme Corp',
      createdAt: new Date('2024-01-01'),
    });

    const res = await request(app)
      .get('/api/tenant')
      .set('Authorization', `Bearer ${makeAccessToken({ role: 'read-only' })}`);

    expect(res.status).toBe(200);
    expect(mockedGetTenantProfile).toHaveBeenCalledWith('tenant-a');
  });
});

// ─── GET /api/tenants/:tenantId ───────────────────────────────────────────────
describe('GET /api/tenants/:tenantId', () => {
  beforeEach(() => jest.clearAllMocks());

  it('200 when path tenant matches token tenant', async () => {
    mockedGetTenantProfile.mockResolvedValue({
      id: 'tenant-a',
      name: 'Acme Corp',
      createdAt: new Date('2024-01-01'),
    });

    const res = await request(app)
      .get('/api/tenants/tenant-a')
      .set('Authorization', `Bearer ${makeAccessToken({ tenantId: 'tenant-a' })}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('tenant-a');
  });

  it('403 when path tenant does not match token tenant', async () => {
    const res = await request(app)
      .get('/api/tenants/tenant-b')
      .set('Authorization', `Bearer ${makeAccessToken({ tenantId: 'tenant-a' })}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
    expect(mockedGetTenantProfile).not.toHaveBeenCalled();
  });
});

// ─── GET /api/users/:userId — cross-tenant isolation ──────────────────────────
describe('GET /api/users/:userId', () => {
  beforeEach(() => jest.clearAllMocks());

  it('200 when user belongs to caller tenant', async () => {
    mockedGetUserInTenant.mockResolvedValue({
      id: 'user-a',
      email: 'user@tenant-a.com',
      role: 'analyst',
      tenantId: 'tenant-a',
    });

    const res = await request(app)
      .get('/api/users/user-a')
      .set('Authorization', `Bearer ${makeAccessToken({ sub: 'user-a', tenantId: 'tenant-a' })}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'user-a', tenantId: 'tenant-a' });
    expect(mockedGetUserInTenant).toHaveBeenCalledWith('tenant-a', 'user-a');
  });

  it('404 when user belongs to another tenant (no existence leak)', async () => {
    mockedGetUserInTenant.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/users/user-b')
      .set('Authorization', `Bearer ${makeAccessToken({ sub: 'user-a', tenantId: 'tenant-a' })}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found');
    expect(mockedGetUserInTenant).toHaveBeenCalledWith('tenant-a', 'user-b');
  });

  it('404 when user does not exist', async () => {
    mockedGetUserInTenant.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/users/missing-user')
      .set('Authorization', `Bearer ${makeAccessToken({ tenantId: 'tenant-a' })}`);

    expect(res.status).toBe(404);
  });

  it('401 without token', async () => {
    const res = await request(app).get('/api/users/user-a');
    expect(res.status).toBe(401);
    expect(mockedGetUserInTenant).not.toHaveBeenCalled();
  });

  it('403 for read-only role', async () => {
    const res = await request(app)
      .get('/api/users/user-a')
      .set('Authorization', `Bearer ${makeAccessToken({ role: 'read-only' })}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
    expect(mockedGetUserInTenant).not.toHaveBeenCalled();
  });
});
