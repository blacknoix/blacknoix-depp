import { updateAlert } from '../services/alertService';
import { logAuthEvent } from '../lib/authAudit';
import { getMetricsSnapshot, resetMetrics } from '../lib/metrics';

const mockFindFirst = jest.fn();
const mockUpdate = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    alert: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
    user: {
      findFirst: jest.fn(),
    },
  },
}));

jest.mock('../lib/authAudit', () => ({
  logAuthEvent: jest.fn(),
  hashClientIp: jest.fn(),
}));

describe('updateAlert audit and metrics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetMetrics();
    mockFindFirst.mockResolvedValue({ id: 'alert-1', status: 'open' });
    mockUpdate.mockResolvedValue({
      id: 'alert-1',
      tenantId: 'tenant-a',
      agentId: 'agent-a',
      telemetryEventId: 'evt-1',
      title: 'HIGH event: file.write',
      severity: 'high',
      status: 'acknowledged',
      ruleId: 'severity-threshold',
      indicator: null,
      assignedToId: null,
      resolvedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it('emits alert_updated with status meta when actor provided', async () => {
    await updateAlert(
      'tenant-a',
      'alert-1',
      { status: 'acknowledged' },
      { userId: 'user-a', role: 'analyst' }
    );

    expect(logAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'alert_updated',
        outcome: 'success',
        tenantId: 'tenant-a',
        userId: 'user-a',
        role: 'analyst',
        alertId: 'alert-1',
        meta: {
          alertId: 'alert-1',
          previousStatus: 'open',
          newStatus: 'acknowledged',
        },
      })
    );
    expect(getMetricsSnapshot().alertsUpdated).toBe(1);
  });

  it('does not emit audit when actor omitted', async () => {
    await updateAlert('tenant-a', 'alert-1', { status: 'acknowledged' });
    expect(logAuthEvent).not.toHaveBeenCalled();
    expect(getMetricsSnapshot().alertsUpdated).toBe(0);
  });
});
