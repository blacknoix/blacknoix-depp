import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../app';
import * as alertService from '../services/alertService';
import { AlertValidationError } from '../types/alert';
import { logAuthEvent } from '../lib/authAudit';
import { resetMetrics } from '../lib/metrics';

jest.mock('../lib/authAudit', () => ({
  logAuthEvent: jest.fn(),
  hashClientIp: jest.fn(() => 'abcd1234'),
}));

jest.mock('../services/alertService', () => ({
  listAlerts: jest.fn(),
  getAlert: jest.fn(),
  updateAlert: jest.fn(),
}));

const mockedListAlerts = alertService.listAlerts as jest.MockedFunction<typeof alertService.listAlerts>;
const mockedGetAlert = alertService.getAlert as jest.MockedFunction<typeof alertService.getAlert>;
const mockedUpdateAlert = alertService.updateAlert as jest.MockedFunction<typeof alertService.updateAlert>;

const app = createApp();
const VALID_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET!;

function makeUserToken(overrides?: Partial<{ sub: string; tenantId: string; role: string }>) {
  return jwt.sign(
    { sub: 'user-a', tenantId: 'tenant-a', role: 'analyst', ...overrides },
    VALID_ACCESS_SECRET,
    { expiresIn: '15m' }
  );
}

const sampleAlertSummary = {
  id: 'alert-1',
  tenantId: 'tenant-a',
  agentId: 'agent-a',
  telemetryEventId: 'evt-1',
  title: 'CRITICAL event: file.write',
  severity: 'critical',
  status: 'open' as const,
  ruleId: 'severity-threshold',
  assignedToId: null,
  createdAt: new Date('2024-06-02T10:00:00.000Z'),
  updatedAt: new Date('2024-06-02T10:00:00.000Z'),
};

const sampleAlertDetail = {
  ...sampleAlertSummary,
  resolvedAt: null,
};

// ─── GET /api/alerts ──────────────────────────────────────────────────────────
describe('GET /api/alerts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetMetrics();
  });

  it('200 + alert list for caller tenant', async () => {
    mockedListAlerts.mockResolvedValue([sampleAlertSummary]);

    const res = await request(app)
      .get('/api/alerts')
      .set('Authorization', `Bearer ${makeUserToken({ tenantId: 'tenant-a' })}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].tenantId).toBe('tenant-a');
    expect(res.body[0].ruleId).toBe('severity-threshold');
    expect(mockedListAlerts).toHaveBeenCalledWith('tenant-a', expect.objectContaining({ limit: 50 }));
    expect(logAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'alert_list',
        outcome: 'success',
        tenantId: 'tenant-a',
        userId: 'user-a',
        meta: expect.objectContaining({ count: 1 }),
      })
    );
  });

  it('only includes alerts scoped to caller tenant via service', async () => {
    mockedListAlerts.mockResolvedValue([{ ...sampleAlertSummary, tenantId: 'tenant-a' }]);

    const res = await request(app)
      .get('/api/alerts')
      .set('Authorization', `Bearer ${makeUserToken({ tenantId: 'tenant-a' })}`);

    expect(res.body.every((a: { tenantId: string }) => a.tenantId === 'tenant-a')).toBe(true);
  });

  it('filter by status=open', async () => {
    mockedListAlerts.mockResolvedValue([]);

    await request(app)
      .get('/api/alerts?status=open')
      .set('Authorization', `Bearer ${makeUserToken()}`);

    expect(mockedListAlerts).toHaveBeenCalledWith(
      'tenant-a',
      expect.objectContaining({ status: 'open' })
    );
  });

  it('filter by severity=critical', async () => {
    mockedListAlerts.mockResolvedValue([]);

    await request(app)
      .get('/api/alerts?severity=critical')
      .set('Authorization', `Bearer ${makeUserToken()}`);

    expect(mockedListAlerts).toHaveBeenCalledWith(
      'tenant-a',
      expect.objectContaining({ severity: 'critical' })
    );
  });

  it('filter by agentId', async () => {
    mockedListAlerts.mockResolvedValue([]);

    await request(app)
      .get('/api/alerts?agentId=agent-a')
      .set('Authorization', `Bearer ${makeUserToken()}`);

    expect(mockedListAlerts).toHaveBeenCalledWith(
      'tenant-a',
      expect.objectContaining({ agentId: 'agent-a' })
    );
  });

  it('filter by ruleId', async () => {
    mockedListAlerts.mockResolvedValue([]);

    await request(app)
      .get('/api/alerts?ruleId=malware-prefix')
      .set('Authorization', `Bearer ${makeUserToken()}`);

    expect(mockedListAlerts).toHaveBeenCalledWith(
      'tenant-a',
      expect.objectContaining({ ruleId: 'malware-prefix' })
    );
    expect(logAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'alert_list',
        meta: expect.objectContaining({ ruleId: 'malware-prefix' }),
      })
    );
  });

  it('does not emit alert_list on paginated unfiltered list', async () => {
    mockedListAlerts.mockResolvedValue([]);
    const before = '2024-06-02T10:00:00.000Z';

    await request(app)
      .get(`/api/alerts?before=${encodeURIComponent(before)}`)
      .set('Authorization', `Bearer ${makeUserToken()}`);

    expect(mockedListAlerts).toHaveBeenCalled();
    expect(logAuthEvent).not.toHaveBeenCalled();
  });

  it('respects limit default 50 and max 200', async () => {
    mockedListAlerts.mockResolvedValue([]);

    await request(app)
      .get('/api/alerts?limit=500')
      .set('Authorization', `Bearer ${makeUserToken()}`);

    expect(mockedListAlerts).toHaveBeenCalledWith(
      'tenant-a',
      expect.objectContaining({ limit: 200 })
    );
  });

  it('respects before cursor', async () => {
    mockedListAlerts.mockResolvedValue([]);
    const before = '2024-06-02T10:00:00.000Z';

    await request(app)
      .get(`/api/alerts?before=${encodeURIComponent(before)}`)
      .set('Authorization', `Bearer ${makeUserToken()}`);

    expect(mockedListAlerts).toHaveBeenCalledWith(
      'tenant-a',
      expect.objectContaining({ before: new Date(before) })
    );
  });

  it('401 without token', async () => {
    const res = await request(app).get('/api/alerts');
    expect(res.status).toBe(401);
    expect(mockedListAlerts).not.toHaveBeenCalled();
  });

  it('403 for read-only role', async () => {
    const res = await request(app)
      .get('/api/alerts')
      .set('Authorization', `Bearer ${makeUserToken({ role: 'read-only' })}`);

    expect(res.status).toBe(403);
    expect(mockedListAlerts).not.toHaveBeenCalled();
  });
});

// ─── GET /api/alerts/:alertId ─────────────────────────────────────────────────
describe('GET /api/alerts/:alertId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetMetrics();
  });

  it('200 + alert detail in caller tenant', async () => {
    mockedGetAlert.mockResolvedValue(sampleAlertDetail);

    const res = await request(app)
      .get('/api/alerts/alert-1')
      .set('Authorization', `Bearer ${makeUserToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('alert-1');
    expect(res.body.ruleId).toBe('severity-threshold');
    expect(mockedGetAlert).toHaveBeenCalledWith('tenant-a', 'alert-1');
    expect(logAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'alert_read',
        outcome: 'success',
        alertId: 'alert-1',
        meta: expect.objectContaining({ alertId: 'alert-1', ruleId: 'severity-threshold' }),
      })
    );
  });

  it('404 for alertId in another tenant', async () => {
    mockedGetAlert.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/alerts/alert-b')
      .set('Authorization', `Bearer ${makeUserToken({ tenantId: 'tenant-a' })}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Alert not found');
    expect(logAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'alert_access_denied', outcome: 'denied' })
    );
  });

  it('404 for non-existent alertId', async () => {
    mockedGetAlert.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/alerts/missing')
      .set('Authorization', `Bearer ${makeUserToken()}`);

    expect(res.status).toBe(404);
    expect(logAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'alert_access_denied', outcome: 'denied' })
    );
  });

  it('401 without token', async () => {
    const res = await request(app).get('/api/alerts/alert-1');
    expect(res.status).toBe(401);
    expect(mockedGetAlert).not.toHaveBeenCalled();
  });

  it('403 for read-only role', async () => {
    const res = await request(app)
      .get('/api/alerts/alert-1')
      .set('Authorization', `Bearer ${makeUserToken({ role: 'read-only' })}`);

    expect(res.status).toBe(403);
    expect(mockedGetAlert).not.toHaveBeenCalled();
  });
});

// ─── PATCH /api/alerts/:alertId ───────────────────────────────────────────────
describe('PATCH /api/alerts/:alertId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetMetrics();
  });

  it('open → acknowledged returns 200', async () => {
    mockedUpdateAlert.mockResolvedValue({ ...sampleAlertDetail, status: 'acknowledged' });

    const res = await request(app)
      .patch('/api/alerts/alert-1')
      .set('Authorization', `Bearer ${makeUserToken()}`)
      .send({ status: 'acknowledged' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('acknowledged');
    expect(mockedUpdateAlert).toHaveBeenCalledWith(
      'tenant-a',
      'alert-1',
      { status: 'acknowledged' },
      { userId: 'user-a', role: 'analyst' }
    );
    expect(logAuthEvent).not.toHaveBeenCalled();
  });

  it('acknowledged → resolved returns 200 with resolvedAt', async () => {
    const resolvedAt = new Date('2024-06-03T10:00:00.000Z');
    mockedUpdateAlert.mockResolvedValue({
      ...sampleAlertDetail,
      status: 'resolved',
      resolvedAt,
    });

    const res = await request(app)
      .patch('/api/alerts/alert-1')
      .set('Authorization', `Bearer ${makeUserToken()}`)
      .send({ status: 'resolved' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('resolved');
    expect(res.body.resolvedAt).toBeDefined();
  });

  it('resolved → acknowledged returns 400', async () => {
    mockedUpdateAlert.mockRejectedValue(
      new AlertValidationError('Cannot transition from resolved to acknowledged')
    );

    const res = await request(app)
      .patch('/api/alerts/alert-1')
      .set('Authorization', `Bearer ${makeUserToken()}`)
      .send({ status: 'acknowledged' });

    expect(res.status).toBe(400);
  });

  it('open → resolved returns 400', async () => {
    mockedUpdateAlert.mockRejectedValue(
      new AlertValidationError('Cannot transition from open to resolved')
    );

    const res = await request(app)
      .patch('/api/alerts/alert-1')
      .set('Authorization', `Bearer ${makeUserToken()}`)
      .send({ status: 'resolved' });

    expect(res.status).toBe(400);
  });

  it('target status open returns 400 before service call', async () => {
    const res = await request(app)
      .patch('/api/alerts/alert-1')
      .set('Authorization', `Bearer ${makeUserToken()}`)
      .send({ status: 'open' });

    expect(res.status).toBe(400);
    expect(mockedUpdateAlert).not.toHaveBeenCalled();
  });

  it('invalid status returns 400 before service call', async () => {
    const res = await request(app)
      .patch('/api/alerts/alert-1')
      .set('Authorization', `Bearer ${makeUserToken()}`)
      .send({ status: 'invalid' });

    expect(res.status).toBe(400);
    expect(mockedUpdateAlert).not.toHaveBeenCalled();
  });

  it('assignee-only update leaves status unchanged', async () => {
    mockedUpdateAlert.mockResolvedValue({ ...sampleAlertDetail, assignedToId: 'user-b' });

    const res = await request(app)
      .patch('/api/alerts/alert-1')
      .set('Authorization', `Bearer ${makeUserToken()}`)
      .send({ assignedToUserId: 'user-b' });

    expect(res.status).toBe(200);
    expect(res.body.assignedToId).toBe('user-b');
    expect(res.body.status).toBe('open');
    expect(mockedUpdateAlert).toHaveBeenCalledWith('tenant-a', 'alert-1', {
      assignedToUserId: 'user-b',
    }, { userId: 'user-a', role: 'analyst' });
  });

  it('explicit unassign with null', async () => {
    mockedUpdateAlert.mockResolvedValue({ ...sampleAlertDetail, assignedToId: null });

    const res = await request(app)
      .patch('/api/alerts/alert-1')
      .set('Authorization', `Bearer ${makeUserToken()}`)
      .send({ assignedToUserId: null });

    expect(res.status).toBe(200);
    expect(res.body.assignedToId).toBeNull();
  });

  it('assignee from another tenant returns 400', async () => {
    mockedUpdateAlert.mockRejectedValue(new AlertValidationError('Assignee not found in this tenant'));

    const res = await request(app)
      .patch('/api/alerts/alert-1')
      .set('Authorization', `Bearer ${makeUserToken()}`)
      .send({ assignedToUserId: 'user-other-tenant' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Assignee not found in this tenant');
  });

  it('missing assignee returns 400', async () => {
    mockedUpdateAlert.mockRejectedValue(new AlertValidationError('Assignee not found in this tenant'));

    const res = await request(app)
      .patch('/api/alerts/alert-1')
      .set('Authorization', `Bearer ${makeUserToken()}`)
      .send({ assignedToUserId: 'missing-user' });

    expect(res.status).toBe(400);
  });

  it('empty body returns 400', async () => {
    const res = await request(app)
      .patch('/api/alerts/alert-1')
      .set('Authorization', `Bearer ${makeUserToken()}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No fields to update');
    expect(mockedUpdateAlert).not.toHaveBeenCalled();
  });

  it('combined resolve + unassign', async () => {
    mockedUpdateAlert.mockResolvedValue({
      ...sampleAlertDetail,
      status: 'resolved',
      assignedToId: null,
      resolvedAt: new Date(),
    });

    const res = await request(app)
      .patch('/api/alerts/alert-1')
      .set('Authorization', `Bearer ${makeUserToken()}`)
      .send({ status: 'resolved', assignedToUserId: null });

    expect(res.status).toBe(200);
    expect(mockedUpdateAlert).toHaveBeenCalledWith('tenant-a', 'alert-1', {
      status: 'resolved',
      assignedToUserId: null,
    }, { userId: 'user-a', role: 'analyst' });
  });

  it('combined acknowledge + assign', async () => {
    mockedUpdateAlert.mockResolvedValue({
      ...sampleAlertDetail,
      status: 'acknowledged',
      assignedToId: 'user-b',
    });

    const res = await request(app)
      .patch('/api/alerts/alert-1')
      .set('Authorization', `Bearer ${makeUserToken()}`)
      .send({ status: 'acknowledged', assignedToUserId: 'user-b' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('acknowledged');
    expect(res.body.assignedToId).toBe('user-b');
  });

  it('cross-tenant alertId returns 404', async () => {
    mockedUpdateAlert.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/alerts/alert-other-tenant')
      .set('Authorization', `Bearer ${makeUserToken()}`)
      .send({ status: 'acknowledged' });

    expect(res.status).toBe(404);
    expect(logAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'alert_access_denied', outcome: 'denied' })
    );
  });

  it('401 without token', async () => {
    const res = await request(app)
      .patch('/api/alerts/alert-1')
      .send({ status: 'acknowledged' });

    expect(res.status).toBe(401);
    expect(mockedUpdateAlert).not.toHaveBeenCalled();
  });

  it('403 for read-only role', async () => {
    const res = await request(app)
      .patch('/api/alerts/alert-1')
      .set('Authorization', `Bearer ${makeUserToken({ role: 'read-only' })}`)
      .send({ status: 'acknowledged' });

    expect(res.status).toBe(403);
    expect(mockedUpdateAlert).not.toHaveBeenCalled();
  });
});
