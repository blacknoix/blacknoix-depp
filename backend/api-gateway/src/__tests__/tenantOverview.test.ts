import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../app';
import * as tenantOverviewService from '../services/tenantOverviewService';

jest.mock('../services/tenantOverviewService', () => ({
  getTenantOverview: jest.fn(),
}));

const mockedGetTenantOverview = tenantOverviewService.getTenantOverview as jest.MockedFunction<
  typeof tenantOverviewService.getTenantOverview
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

const sampleOverview = {
  tenant: { id: 'tenant-a', name: 'Acme Corp' },
  agents: {
    total: 2,
    byStatus: {
      pending: 0,
      active: 2,
      inactive: 0,
      revoked: 0,
      expired: 0,
    },
    recentlySeen: 1,
  },
  alerts: {
    total: 3,
    byStatus: { open: 2, acknowledged: 1, resolved: 0 },
    bySeverity: { info: 0, low: 0, medium: 0, high: 2, critical: 1 },
  },
  telemetry: { events24h: 42 },
  activity: {
    lastTelemetryReceivedAt: '2024-06-02T10:00:00.000Z',
    lastAlertCreatedAt: '2024-06-02T09:00:00.000Z',
    lastAgentSeenAt: '2024-06-02T08:00:00.000Z',
  },
  generatedAt: '2024-06-02T12:00:00.000Z',
};

describe('GET /api/tenant/overview', () => {
  beforeEach(() => jest.clearAllMocks());

  it('200 + overview payload for analyst role', async () => {
    mockedGetTenantOverview.mockResolvedValue(sampleOverview);

    const res = await request(app)
      .get('/api/tenant/overview')
      .set('Authorization', `Bearer ${makeAccessToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.tenant.id).toBe('tenant-a');
    expect(res.body.tenant.name).toBe('Acme Corp');
    expect(res.body.agents.total).toBe(2);
    expect(res.body.alerts.total).toBe(3);
    expect(res.body.alerts.bySeverity.critical).toBe(1);
    expect(res.body.telemetry.events24h).toBe(42);
    expect(res.body.activity.lastTelemetryReceivedAt).toBe('2024-06-02T10:00:00.000Z');
    expect(res.body.generatedAt).toBe('2024-06-02T12:00:00.000Z');
    expect(mockedGetTenantOverview).toHaveBeenCalledWith('tenant-a');
  });

  it('401 without Authorization header', async () => {
    const res = await request(app).get('/api/tenant/overview');
    expect(res.status).toBe(401);
    expect(mockedGetTenantOverview).not.toHaveBeenCalled();
  });

  it('403 for read-only role', async () => {
    const res = await request(app)
      .get('/api/tenant/overview')
      .set('Authorization', `Bearer ${makeAccessToken({ role: 'read-only' })}`);

    expect(res.status).toBe(403);
    expect(mockedGetTenantOverview).not.toHaveBeenCalled();
  });

  it('404 when tenant overview service returns null', async () => {
    mockedGetTenantOverview.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/tenant/overview')
      .set('Authorization', `Bearer ${makeAccessToken()}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Tenant not found');
    expect(mockedGetTenantOverview).toHaveBeenCalledWith('tenant-a');
  });

  it('scopes overview to token tenantId only', async () => {
    mockedGetTenantOverview.mockResolvedValue({
      ...sampleOverview,
      tenant: { id: 'tenant-b', name: 'Other' },
    });

    await request(app)
      .get('/api/tenant/overview')
      .set('Authorization', `Bearer ${makeAccessToken({ tenantId: 'tenant-b' })}`);

    expect(mockedGetTenantOverview).toHaveBeenCalledWith('tenant-b');
    expect(mockedGetTenantOverview).not.toHaveBeenCalledWith('tenant-a');
  });

  it('empty tenant overview returns zeros and null activity not 500', async () => {
    mockedGetTenantOverview.mockResolvedValue({
      tenant: { id: 'tenant-a', name: 'Empty Co' },
      agents: {
        total: 0,
        byStatus: { pending: 0, active: 0, inactive: 0, revoked: 0, expired: 0 },
        recentlySeen: 0,
      },
      alerts: {
        total: 0,
        byStatus: { open: 0, acknowledged: 0, resolved: 0 },
        bySeverity: { info: 0, low: 0, medium: 0, high: 0, critical: 0 },
      },
      telemetry: { events24h: 0 },
      activity: {
        lastTelemetryReceivedAt: null,
        lastAlertCreatedAt: null,
        lastAgentSeenAt: null,
      },
      generatedAt: '2024-06-02T12:00:00.000Z',
    });

    const res = await request(app)
      .get('/api/tenant/overview')
      .set('Authorization', `Bearer ${makeAccessToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.agents.total).toBe(0);
    expect(res.body.activity.lastAlertCreatedAt).toBeNull();
  });
});
