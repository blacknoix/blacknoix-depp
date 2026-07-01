import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../app';
import { resetMetrics, getMetricsSnapshot } from '../lib/metrics';
import { logAuthEvent } from '../lib/authAudit';

const mockAgentFindFirst = jest.fn();
const mockAgentFindFirstAuth = jest.fn();
const mockAgentUpdate = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    agent: {
      findFirst: (...args: unknown[]) => {
        const where = (args[0] as { where?: { tokenHash?: string } })?.where;
        if (where?.tokenHash) {
          return mockAgentFindFirstAuth(...args);
        }
        return mockAgentFindFirst(...args);
      },
      update: (...args: unknown[]) => mockAgentUpdate(...args),
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

const activeAgentRow = {
  id: 'agent-1',
  tenantId: 'tenant-a',
  status: 'active',
  isolatedAt: null as Date | null,
};

function adminToken(overrides?: Partial<{ tenantId: string; role: string }>) {
  return jwt.sign(
    { sub: 'admin-user', tenantId: 'tenant-a', role: 'admin', ...overrides },
    ACCESS_SECRET,
    { expiresIn: '15m' }
  );
}

const mockedLogAuthEvent = logAuthEvent as jest.MockedFunction<typeof logAuthEvent>;

function isolationAudit(action: 'agent_isolated' | 'agent_restored' | 'agent_isolation_access_denied') {
  return mockedLogAuthEvent.mock.calls
    .map((call) => call[0])
    .filter((event) => event.action === action);
}

beforeEach(() => {
  resetMetrics();
  jest.clearAllMocks();
});

describe('POST /api/agents/:agentId/isolate', () => {
  it('200 with isolation state for admin', async () => {
    const isolatedAt = new Date('2026-06-23T12:00:00.000Z');
    mockAgentFindFirst.mockResolvedValue(activeAgentRow);
    mockAgentUpdate.mockResolvedValue({ ...activeAgentRow, isolatedAt });

    const res = await request(app)
      .post('/api/agents/agent-1/isolate')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ reason: 'active_incident' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      agentId: 'agent-1',
      tenantId: 'tenant-a',
      status: 'active',
      isolated: true,
      isolatedAt: isolatedAt.toISOString(),
    });
    expect(getMetricsSnapshot().agentsIsolated).toBe(1);
    expect(isolationAudit('agent_isolated')).toHaveLength(1);
    expect(isolationAudit('agent_isolation_access_denied')).toHaveLength(0);
  });

  it('403 when analyst attempts isolate', async () => {
    const res = await request(app)
      .post('/api/agents/agent-1/isolate')
      .set('Authorization', `Bearer ${adminToken({ role: 'analyst' })}`)
      .send({ reason: 'should_fail' });

    expect(res.status).toBe(403);
    expect(mockAgentFindFirst).not.toHaveBeenCalled();
    expect(isolationAudit('agent_isolated')).toHaveLength(0);
    expect(mockedLogAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'access_denied_insufficient_role' })
    );
  });

  it('401 without auth', async () => {
    const res = await request(app)
      .post('/api/agents/agent-1/isolate')
      .send({ reason: 'no_auth' });

    expect(res.status).toBe(401);
    expect(isolationAudit('agent_isolated')).toHaveLength(0);
  });

  it('404 for cross-tenant agent id with access-denied audit', async () => {
    mockAgentFindFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/agents/agent-other/isolate')
      .set('Authorization', `Bearer ${adminToken({ tenantId: 'tenant-a' })}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Agent not found' });
    expect(isolationAudit('agent_isolated')).toHaveLength(0);
    expect(isolationAudit('agent_isolation_access_denied')).toHaveLength(1);
  });

  it('404 for empty agent id without 500', async () => {
    const res = await request(app)
      .post('/api/agents/%20/isolate')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(404);
    expect(mockAgentFindFirst).not.toHaveBeenCalled();
  });

  it('does not emit agent_isolated on 403 or 404', async () => {
    mockAgentFindFirst.mockResolvedValue(null);

    await request(app)
      .post('/api/agents/missing/isolate')
      .set('Authorization', `Bearer ${adminToken()}`);

    await request(app)
      .post('/api/agents/agent-1/isolate')
      .set('Authorization', `Bearer ${adminToken({ role: 'analyst' })}`);

    expect(isolationAudit('agent_isolated')).toHaveLength(0);
  });
});

describe('POST /api/agents/:agentId/restore', () => {
  it('200 and clears isolation for admin', async () => {
    const isolatedAt = new Date('2026-06-23T12:00:00.000Z');
    mockAgentFindFirst.mockResolvedValue({ ...activeAgentRow, isolatedAt });
    mockAgentUpdate.mockResolvedValue({ ...activeAgentRow, isolatedAt: null });

    const res = await request(app)
      .post('/api/agents/agent-1/restore')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.isolated).toBe(false);
    expect(res.body.isolatedAt).toBeNull();
    expect(getMetricsSnapshot().agentsRestored).toBe(1);
    expect(isolationAudit('agent_restored')).toHaveLength(1);
  });

  it('403 when analyst attempts restore', async () => {
    const res = await request(app)
      .post('/api/agents/agent-1/restore')
      .set('Authorization', `Bearer ${adminToken({ role: 'analyst' })}`);

    expect(res.status).toBe(403);
    expect(isolationAudit('agent_restored')).toHaveLength(0);
  });

  it('emits agent_restored only on 200', async () => {
    mockAgentFindFirst.mockResolvedValue(null);

    await request(app)
      .post('/api/agents/missing/restore')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(isolationAudit('agent_restored')).toHaveLength(0);
    expect(isolationAudit('agent_isolation_access_denied')).toHaveLength(1);
  });
});
