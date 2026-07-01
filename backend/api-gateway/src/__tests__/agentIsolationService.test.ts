import { logAuthEvent } from '../lib/authAudit';
import { resetMetrics, getMetricsSnapshot } from '../lib/metrics';
import { isolateAgent, restoreAgent } from '../services/agentIsolationService';
import { AgentIsolationError } from '../types/agentIsolation';

jest.mock('../lib/authAudit', () => ({
  logAuthEvent: jest.fn(),
  hashClientIp: jest.fn(),
  hashAgentClientIp: jest.fn(),
}));

const mockAgentFindFirst = jest.fn();
const mockAgentUpdate = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    agent: {
      findFirst: (...args: unknown[]) => mockAgentFindFirst(...args),
      update: (...args: unknown[]) => mockAgentUpdate(...args),
    },
  },
}));

const mockedLogAuthEvent = logAuthEvent as jest.MockedFunction<typeof logAuthEvent>;

const actor = { userId: 'admin-user', role: 'admin' };
const tenantId = 'tenant-a';
const agentId = 'agent-1';

const activeRow = {
  id: agentId,
  tenantId,
  status: 'active',
  isolatedAt: null as Date | null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAgentFindFirst.mockReset();
  mockAgentUpdate.mockReset();
  resetMetrics();
});

describe('agentIsolationService.isolateAgent', () => {
  it('transitions isolation state and captures reason', async () => {
    const isolatedAt = new Date('2026-06-23T12:00:00.000Z');
    mockAgentFindFirst.mockResolvedValue(activeRow);
    mockAgentUpdate.mockResolvedValue({ ...activeRow, isolatedAt });

    const result = await isolateAgent(tenantId, agentId, actor, 'suspected_lateral_movement');

    expect(result).toEqual({
      agentId,
      tenantId,
      status: 'active',
      isolated: true,
      isolatedAt: isolatedAt.toISOString(),
    });
    expect(mockAgentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: agentId },
        data: { isolatedAt: expect.any(Date) },
      })
    );
    expect(mockedLogAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'agent_isolated',
        outcome: 'success',
        tenantId,
        userId: actor.userId,
        role: actor.role,
        agentId,
        reason: 'suspected_lateral_movement',
        meta: expect.objectContaining({ operatorReason: 'suspected_lateral_movement' }),
      })
    );
    expect(getMetricsSnapshot().agentsIsolated).toBe(1);
  });

  it('returns null for cross-tenant agent without leaking existence', async () => {
    mockAgentFindFirst.mockResolvedValue(null);

    const result = await isolateAgent(tenantId, 'agent-other', actor);

    expect(result).toBeNull();
    expect(mockAgentUpdate).not.toHaveBeenCalled();
    expect(mockedLogAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'agent_isolation_access_denied',
        outcome: 'denied',
        httpStatus: 404,
        reason: 'not_found',
      })
    );
    expect(getMetricsSnapshot().agentsIsolated).toBe(0);
  });

  it('is idempotent when already isolated', async () => {
    const isolatedAt = new Date('2026-06-23T11:00:00.000Z');
    mockAgentFindFirst.mockResolvedValue({ ...activeRow, isolatedAt });

    const result = await isolateAgent(tenantId, agentId, actor, 'repeat');

    expect(result?.isolated).toBe(true);
    expect(result?.isolatedAt).toBe(isolatedAt.toISOString());
    expect(mockAgentUpdate).not.toHaveBeenCalled();
    expect(mockedLogAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'agent_isolated',
        outcome: 'success',
        reason: 'repeat',
        meta: { alreadyIsolated: true },
      })
    );
    expect(getMetricsSnapshot().agentsIsolated).toBe(0);
  });

  it('rejects terminal agent status', async () => {
    mockAgentFindFirst.mockResolvedValue({ ...activeRow, status: 'revoked' });

    await expect(isolateAgent(tenantId, agentId, actor)).rejects.toBeInstanceOf(AgentIsolationError);
    expect(mockAgentUpdate).not.toHaveBeenCalled();
  });
});

describe('agentIsolationService.restoreAgent', () => {
  it('clears isolation and returns baseline state', async () => {
    const isolatedAt = new Date('2026-06-23T12:00:00.000Z');
    mockAgentFindFirst.mockResolvedValue({ ...activeRow, isolatedAt });
    mockAgentUpdate.mockResolvedValue({ ...activeRow, isolatedAt: null });

    const result = await restoreAgent(tenantId, agentId, actor);

    expect(result).toEqual({
      agentId,
      tenantId,
      status: 'active',
      isolated: false,
      isolatedAt: null,
    });
    expect(mockAgentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: agentId },
        data: { isolatedAt: null },
      })
    );
    expect(mockedLogAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'agent_restored',
        outcome: 'success',
        agentId,
        meta: expect.objectContaining({ previousIsolatedAt: isolatedAt.toISOString() }),
      })
    );
    expect(getMetricsSnapshot().agentsRestored).toBe(1);
  });

  it('is idempotent when not isolated', async () => {
    mockAgentFindFirst.mockResolvedValue(activeRow);

    const result = await restoreAgent(tenantId, agentId, actor);

    expect(result?.isolated).toBe(false);
    expect(mockAgentUpdate).not.toHaveBeenCalled();
    expect(mockedLogAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'agent_restored',
        outcome: 'success',
        reason: 'not_isolated',
        meta: { alreadyRestored: true },
      })
    );
    expect(getMetricsSnapshot().agentsRestored).toBe(0);
  });

  it('isolate then restore returns to baseline', async () => {
    const isolatedAt = new Date('2026-06-23T12:00:00.000Z');
    mockAgentFindFirst
      .mockResolvedValueOnce(activeRow)
      .mockResolvedValueOnce({ ...activeRow, isolatedAt })
      .mockResolvedValueOnce({ ...activeRow, isolatedAt });
    mockAgentUpdate
      .mockResolvedValueOnce({ ...activeRow, isolatedAt })
      .mockResolvedValueOnce({ ...activeRow, isolatedAt: null });

    const isolated = await isolateAgent(tenantId, agentId, actor, 'contain');
    const restored = await restoreAgent(tenantId, agentId, actor);

    expect(isolated?.isolated).toBe(true);
    expect(restored?.isolated).toBe(false);
    expect(restored?.isolatedAt).toBeNull();
  });

  it('returns null for cross-tenant restore', async () => {
    mockAgentFindFirst.mockResolvedValue(null);

    const result = await restoreAgent(tenantId, 'missing', actor);

    expect(result).toBeNull();
    expect(mockedLogAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'agent_isolation_access_denied', outcome: 'denied' })
    );
  });
});
