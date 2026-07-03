import { getTenantOverview } from '../services/tenantOverviewService';
import { TENANT_OVERVIEW_WINDOW_MS } from '../types/tenantOverview';

const mockAgentGroupBy = jest.fn();
const mockAgentCount = jest.fn();
const mockAgentFindFirst = jest.fn();
const mockAlertGroupBy = jest.fn();
const mockAlertFindFirst = jest.fn();
const mockTelemetryCount = jest.fn();
const mockTelemetryFindFirst = jest.fn();
const mockGetTenantProfile = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    agent: {
      groupBy: (...args: unknown[]) => mockAgentGroupBy(...args),
      count: (...args: unknown[]) => mockAgentCount(...args),
      findFirst: (...args: unknown[]) => mockAgentFindFirst(...args),
    },
    alert: {
      groupBy: (...args: unknown[]) => mockAlertGroupBy(...args),
      findFirst: (...args: unknown[]) => mockAlertFindFirst(...args),
    },
    telemetryEvent: {
      count: (...args: unknown[]) => mockTelemetryCount(...args),
      findFirst: (...args: unknown[]) => mockTelemetryFindFirst(...args),
    },
  },
}));

jest.mock('../services/tenantService', () => ({
  getTenantProfile: (...args: unknown[]) => mockGetTenantProfile(...args),
}));

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

function setupEmptyTenantMocks(): void {
  mockGetTenantProfile.mockResolvedValue({ id: TENANT_A, name: 'Acme', createdAt: new Date() });
  mockAgentGroupBy.mockResolvedValue([]);
  mockAgentCount.mockResolvedValue(0);
  mockAlertGroupBy.mockResolvedValue([]);
  mockTelemetryCount.mockResolvedValue(0);
  mockTelemetryFindFirst.mockResolvedValue(null);
  mockAlertFindFirst.mockResolvedValue(null);
  mockAgentFindFirst.mockResolvedValue(null);
}

beforeEach(() => {
  jest.clearAllMocks();
  setupEmptyTenantMocks();
});

describe('getTenantOverview', () => {
  it('returns null when tenant does not exist', async () => {
    mockGetTenantProfile.mockResolvedValue(null);
    const result = await getTenantOverview(TENANT_A);
    expect(result).toBeNull();
    expect(mockAgentGroupBy).not.toHaveBeenCalled();
  });

  it('empty tenant returns zeros and null activity without throwing', async () => {
    const result = await getTenantOverview(TENANT_A);
    expect(result).not.toBeNull();
    expect(result!.tenant).toEqual({ id: TENANT_A, name: 'Acme' });
    expect(result!.agents.total).toBe(0);
    expect(result!.agents.byStatus).toEqual({
      pending: 0,
      active: 0,
      inactive: 0,
      revoked: 0,
      expired: 0,
    });
    expect(result!.agents.recentlySeen).toBe(0);
    expect(result!.alerts.total).toBe(0);
    expect(result!.alerts.byStatus).toEqual({
      open: 0,
      acknowledged: 0,
      resolved: 0,
    });
    expect(result!.alerts.bySeverity).toEqual({
      info: 0,
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    });
    expect(result!.telemetry.events24h).toBe(0);
    expect(result!.activity).toEqual({
      lastTelemetryReceivedAt: null,
      lastAlertCreatedAt: null,
      lastAgentSeenAt: null,
    });
    expect(result!.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('aggregates agent status counts from groupBy', async () => {
    mockAgentGroupBy.mockResolvedValue([
      { status: 'active', _count: { _all: 2 } },
      { status: 'pending', _count: { _all: 1 } },
    ]);

    const result = await getTenantOverview(TENANT_A);
    expect(result!.agents.total).toBe(3);
    expect(result!.agents.byStatus.active).toBe(2);
    expect(result!.agents.byStatus.pending).toBe(1);
    expect(result!.agents.byStatus.inactive).toBe(0);
  });

  it('aggregates alert status and severity counts from groupBy', async () => {
    let alertGroupCall = 0;
    mockAlertGroupBy.mockImplementation(async () => {
      alertGroupCall += 1;
      if (alertGroupCall === 1) {
        return [
          { status: 'open', _count: { _all: 4 } },
          { status: 'resolved', _count: { _all: 1 } },
        ];
      }
      return [
        { severity: 'high', _count: { _all: 2 } },
        { severity: 'critical', _count: { _all: 1 } },
      ];
    });

    const result = await getTenantOverview(TENANT_A);
    expect(result!.alerts.total).toBe(5);
    expect(result!.alerts.byStatus.open).toBe(4);
    expect(result!.alerts.byStatus.resolved).toBe(1);
    expect(result!.alerts.bySeverity.high).toBe(2);
    expect(result!.alerts.bySeverity.critical).toBe(1);
    expect(mockAlertGroupBy).toHaveBeenCalledTimes(2);
  });

  it('scopes every query to the requested tenantId', async () => {
    await getTenantOverview(TENANT_A);

    expect(mockAgentGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT_A } })
    );
    expect(mockAgentCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: TENANT_A }) })
    );
    expect(mockTelemetryCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: TENANT_A }) })
    );
    expect(mockAlertGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT_A } })
    );

    await getTenantOverview(TENANT_B);
    expect(mockAgentGroupBy).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT_B } })
    );
  });

  it('counts telemetry only within the 24h rolling window', async () => {
    const beforeCount = mockTelemetryCount.mock.calls.length;
    await getTenantOverview(TENANT_A);

    const countArg = mockTelemetryCount.mock.calls[beforeCount][0];
    const windowStart: Date = countArg.where.receivedAt.gte;
    const now = Date.now();
    expect(now - windowStart.getTime()).toBeGreaterThanOrEqual(TENANT_OVERVIEW_WINDOW_MS - 1000);
    expect(now - windowStart.getTime()).toBeLessThanOrEqual(TENANT_OVERVIEW_WINDOW_MS + 1000);
  });

  it('recentlySeen uses lastSeenAt within the same 24h window', async () => {
    mockAgentCount.mockResolvedValue(2);
    await getTenantOverview(TENANT_A);

    const countArg = mockAgentCount.mock.calls[0][0];
    expect(countArg.where.lastSeenAt.gte).toBeInstanceOf(Date);
    expect(countArg.where.tenantId).toBe(TENANT_A);
    expect((await getTenantOverview(TENANT_A))!.agents.recentlySeen).toBe(2);
  });

  it('returns latest activity timestamps as ISO strings', async () => {
    const telemetryAt = new Date('2024-06-02T10:00:00.000Z');
    const alertAt = new Date('2024-06-02T09:00:00.000Z');
    const agentSeenAt = new Date('2024-06-02T08:00:00.000Z');

    mockTelemetryFindFirst.mockResolvedValue({ receivedAt: telemetryAt });
    mockAlertFindFirst.mockResolvedValue({ createdAt: alertAt });
    mockAgentFindFirst.mockResolvedValue({ lastSeenAt: agentSeenAt });

    const result = await getTenantOverview(TENANT_A);
    expect(result!.activity).toEqual({
      lastTelemetryReceivedAt: telemetryAt.toISOString(),
      lastAlertCreatedAt: alertAt.toISOString(),
      lastAgentSeenAt: agentSeenAt.toISOString(),
    });
  });
});
