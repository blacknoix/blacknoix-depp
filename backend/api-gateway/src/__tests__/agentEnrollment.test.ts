import crypto from 'crypto';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../app';
import { AGENT_TOKEN_PREFIX } from '../lib/agentToken';
import { hashAgentToken } from '../services/agentService';
import { resetMetrics, getMetricsSnapshot } from '../lib/metrics';
import { logAuthEvent } from '../lib/authAudit';

const mockAgentCreate = jest.fn();
const mockAgentFindFirst = jest.fn();
const mockAgentFindFirstAuth = jest.fn();
const mockAgentUpdate = jest.fn();
const mockAgentUpdateMany = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    agent: {
      create: (...args: unknown[]) => mockAgentCreate(...args),
      findFirst: (...args: unknown[]) => {
        const where = (args[0] as { where?: { tokenHash?: string; id?: string } })?.where;
        if (where?.tokenHash) {
          return mockAgentFindFirstAuth(...args);
        }
        return mockAgentFindFirst(...args);
      },
      update: (...args: unknown[]) => mockAgentUpdate(...args),
      updateMany: (...args: unknown[]) => mockAgentUpdateMany(...args),
    },
  },
}));

jest.mock('../lib/authAudit', () => ({
  logAuthEvent: jest.fn(),
  hashClientIp: jest.fn(),
  hashAgentClientIp: jest.fn(),
}));

const app = createApp();
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET!;

const pendingExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

const sampleAgentRow = {
  id: 'agent-1',
  tenantId: 'tenant-a',
  displayName: 'prod-endpoint-01',
  hostname: 'endpoint-01',
  os: 'linux',
  agentVersion: '1.0.0',
  status: 'pending' as const,
  tokenPrefix: 'depp_agt_a3f2b91c',
  enrolledByUserId: 'admin-user',
  pendingExpiresAt,
  registeredAt: new Date('2024-06-01'),
};

function adminToken(overrides?: Partial<{ tenantId: string; role: string }>) {
  return jwt.sign(
    { sub: 'admin-user', tenantId: 'tenant-a', role: 'admin', ...overrides },
    ACCESS_SECRET,
    { expiresIn: '15m' }
  );
}

const validBody = {
  displayName: 'prod-endpoint-01',
  hostname: 'endpoint-01',
  os: 'linux',
  agentVersion: '1.0.0',
};

beforeEach(() => {
  resetMetrics();
  jest.clearAllMocks();
  mockAgentUpdate.mockResolvedValue({});
  mockAgentUpdateMany.mockResolvedValue({ count: 1 });
});

describe('POST /api/agents/enroll', () => {
  it('201 + enrollmentToken for admin', async () => {
    mockAgentCreate.mockImplementation(async (args: { data: { tokenHash: string; tokenPrefix: string } }) => ({
      ...sampleAgentRow,
      tokenPrefix: args.data.tokenPrefix,
    }));

    const res = await request(app)
      .post('/api/agents/enroll')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.enrollmentToken).toMatch(/^depp_agt_[0-9a-f]{64}$/i);
    expect(res.body._tokenWarning).toContain('will not be shown again');
    expect(res.body.agent).toMatchObject({
      displayName: 'prod-endpoint-01',
      hostname: 'endpoint-01',
      tenantId: 'tenant-a',
      status: 'pending',
      tokenPrefix: expect.stringMatching(/^depp_agt_/),
      enrolledBy: 'admin-user',
    });
    expect(res.body.tokenHash).toBeUndefined();
    expect(res.body.enrollmentToken).toBeDefined();

    const createArg = mockAgentCreate.mock.calls[0][0];
    expect(createArg.data.tokenHash).toHaveLength(64);
    expect(createArg.data.enrolledByUserId).toBe('admin-user');
    expect(createArg.data.pendingExpiresAt).toBeInstanceOf(Date);
    expect(createArg.data.tokenHash).toBe(hashAgentToken(res.body.enrollmentToken));
    expect(getMetricsSnapshot().agentEnrollmentSuccess).toBe(1);
  });

  it('403 when analyst attempts enrollment', async () => {
    const res = await request(app)
      .post('/api/agents/enroll')
      .set('Authorization', `Bearer ${adminToken({ role: 'analyst' })}`)
      .send(validBody);

    expect(res.status).toBe(403);
    expect(mockAgentCreate).not.toHaveBeenCalled();
  });

  it('does not log raw token in audit events', async () => {
    mockAgentCreate.mockImplementation(async (args: { data: { tokenPrefix: string } }) => ({
      ...sampleAgentRow,
      tokenPrefix: args.data.tokenPrefix,
    }));

    await request(app)
      .post('/api/agents/enroll')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(validBody);

    const auditCalls = (logAuthEvent as jest.Mock).mock.calls.map((c) => JSON.stringify(c[0]));
    for (const line of auditCalls) {
      expect(line).not.toMatch(/depp_agt_[0-9a-f]{20,}/i);
    }
  });
});

describe('GET /api/agents/:agentId', () => {
  it('does not return enrollmentToken on detail fetch', async () => {
    mockAgentFindFirst.mockResolvedValue({
      ...sampleAgentRow,
      ipAddress: null,
      lastSeenAt: null,
      lastAgentVersion: null,
      createdAt: new Date('2024-06-01'),
      updatedAt: new Date('2024-06-01'),
    });

    const res = await request(app)
      .get('/api/agents/agent-1')
      .set('Authorization', `Bearer ${adminToken({ role: 'analyst' })}`);

    expect(res.status).toBe(200);
    expect(res.body.enrollmentToken).toBeUndefined();
    expect(res.body.tokenHash).toBeUndefined();
  });
});

describe('POST /api/agents/:agentId/revoke', () => {
  it('200 and sets status revoked for admin', async () => {
    mockAgentFindFirst.mockResolvedValue(sampleAgentRow);
    mockAgentUpdate.mockResolvedValue({ ...sampleAgentRow, status: 'revoked' });

    const res = await request(app)
      .post('/api/agents/agent-1/revoke')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ reason: 'suspected_compromise' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('revoked');
    expect(mockAgentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'agent-1' },
        data: { status: 'revoked' },
      })
    );
    expect(getMetricsSnapshot().agentRevoked).toBe(1);
  });

  it('404 for cross-tenant agent id', async () => {
    mockAgentFindFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/agents/agent-other/revoke')
      .set('Authorization', `Bearer ${adminToken({ tenantId: 'tenant-a' })}`);

    expect(res.status).toBe(404);
    expect(mockAgentUpdate).not.toHaveBeenCalled();
  });

  it('403 when analyst attempts revoke', async () => {
    const res = await request(app)
      .post('/api/agents/agent-1/revoke')
      .set('Authorization', `Bearer ${adminToken({ role: 'analyst' })}`);

    expect(res.status).toBe(403);
    expect(mockAgentFindFirst).not.toHaveBeenCalled();
  });
});

describe('agent Bearer token auth', () => {
  const secret = crypto.randomBytes(32).toString('hex');
  const enrollmentToken = `${AGENT_TOKEN_PREFIX}${secret}`;
  const agentId = '11111111-1111-4111-8111-111111111111';

  function mockAuthAgent(overrides?: Partial<{
    status: string;
    pendingExpiresAt: Date;
  }>) {
    mockAgentFindFirstAuth.mockResolvedValue({
      id: agentId,
      tenantId: 'tenant-a',
      status: overrides?.status ?? 'pending',
      tokenHash: hashAgentToken(enrollmentToken),
      tokenPrefix: enrollmentToken.slice(0, 17),
      pendingExpiresAt: overrides?.pendingExpiresAt ?? pendingExpiresAt,
    });
    mockAgentFindFirst.mockResolvedValue({ id: agentId, status: overrides?.status ?? 'pending' });
  }

  it('heartbeat succeeds with valid pending token and activates agent', async () => {
    mockAuthAgent({ status: 'pending' });

    const res = await request(app)
      .post('/agent/heartbeat')
      .set('Authorization', `Bearer ${enrollmentToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', agentId, tenantId: 'tenant-a' });
    expect(getMetricsSnapshot().agentAuthSuccess).toBe(1);
    expect(mockAgentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: agentId },
        data: expect.objectContaining({ status: 'active' }),
      })
    );
  });

  it('heartbeat succeeds with valid active token', async () => {
    mockAuthAgent({ status: 'active' });

    const res = await request(app)
      .post('/agent/heartbeat')
      .set('Authorization', `Bearer ${enrollmentToken}`);

    expect(res.status).toBe(200);
  });

  it('401 for expired pending token', async () => {
    mockAuthAgent({
      status: 'pending',
      pendingExpiresAt: new Date(Date.now() - 60_000),
    });

    const res = await request(app)
      .post('/agent/heartbeat')
      .set('Authorization', `Bearer ${enrollmentToken}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
    expect(getMetricsSnapshot().agentAuthFailure).toBe(1);
    expect(mockAgentUpdateMany).toHaveBeenCalled();
  });

  it('401 for revoked token (same body as unknown token)', async () => {
    mockAuthAgent({ status: 'revoked' });

    const res = await request(app)
      .post('/agent/heartbeat')
      .set('Authorization', `Bearer ${enrollmentToken}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
    expect(getMetricsSnapshot().agentAuthFailure).toBe(1);
  });

  it('401 for unknown token', async () => {
    mockAgentFindFirstAuth.mockResolvedValue(null);

    const unknownToken = `${AGENT_TOKEN_PREFIX}${'f'.repeat(64)}`;
    const res = await request(app)
      .post('/agent/heartbeat')
      .set('Authorization', `Bearer ${unknownToken}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('401 for wrong secret', async () => {
    mockAuthAgent({ status: 'pending' });

    const wrongToken = `${AGENT_TOKEN_PREFIX}${'0'.repeat(64)}`;
    const res = await request(app)
      .post('/agent/heartbeat')
      .set('Authorization', `Bearer ${wrongToken}`);

    expect(res.status).toBe(401);
    expect(getMetricsSnapshot().agentAuthFailure).toBe(1);
  });

  it('401 without Authorization header', async () => {
    const res = await request(app).post('/agent/heartbeat');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
    expect(getMetricsSnapshot().agentAuthFailure).toBe(1);
  });

  it('tenantId on req.agent comes from DB row', async () => {
    mockAuthAgent({ status: 'active' });

    const res = await request(app)
      .post('/agent/heartbeat')
      .set('Authorization', `Bearer ${enrollmentToken}`)
      .send({ tenantId: 'tenant-b' });

    expect(res.status).toBe(200);
    expect(res.body.tenantId).toBe('tenant-a');
  });
});

describe('POST /telemetry/events', () => {
  const secret = crypto.randomBytes(32).toString('hex');
  const enrollmentToken = `${AGENT_TOKEN_PREFIX}${secret}`;
  const agentId = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    mockAgentFindFirstAuth.mockResolvedValue({
      id: agentId,
      tenantId: 'tenant-a',
      status: 'active',
      tokenHash: hashAgentToken(enrollmentToken),
      tokenPrefix: enrollmentToken.slice(0, 17),
      pendingExpiresAt,
    });
  });

  it('401 with invalid credential', async () => {
    mockAgentFindFirstAuth.mockResolvedValue(null);

    const res = await request(app)
      .post('/telemetry/events')
      .set('Authorization', `Bearer ${AGENT_TOKEN_PREFIX}${'a'.repeat(64)}`)
      .send([
        {
          eventType: 'process.start',
          severity: 'low',
          occurredAt: '2024-06-01T12:00:00.000Z',
          payload: { pid: 1 },
        },
      ]);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });
});
