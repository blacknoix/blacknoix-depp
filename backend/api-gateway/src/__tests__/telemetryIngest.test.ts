import { ingestTelemetryBatch } from '../services/telemetryService';
import { TelemetryEventInput } from '../types/telemetry';
import { logAuthEvent } from '../lib/authAudit';
import { getMetricsSnapshot, resetMetrics } from '../lib/metrics';

let capturedTx: {
  telemetryEvent: { createMany: jest.Mock };
  agent: { update: jest.Mock };
  alert: { createMany: jest.Mock };
};

const mockTransaction = jest.fn();

jest.mock('../lib/authAudit', () => ({
  logAuthEvent: jest.fn(),
  hashClientIp: jest.fn(),
}));

jest.mock('../lib/prisma', () => ({
  prisma: {
    $transaction: (fn: (tx: typeof capturedTx) => Promise<unknown>) => mockTransaction(fn),
  },
}));

function event(overrides?: Partial<TelemetryEventInput>): TelemetryEventInput {
  return {
    eventType: 'process.start',
    severity: 'low',
    occurredAt: '2024-06-01T12:00:00.000Z',
    payload: { pid: 1 },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetMetrics();
  mockTransaction.mockImplementation(async (fn: (tx: typeof capturedTx) => Promise<unknown>) => {
    capturedTx = {
      telemetryEvent: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      agent: { update: jest.fn().mockResolvedValue({}) },
      alert: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    return fn(capturedTx);
  });
});

describe('ingestTelemetryBatch transaction', () => {
  it('high-severity alert includes ruleId and telemetryEventId', async () => {
    await ingestTelemetryBatch('agent-a', 'tenant-a', [
      event({ severity: 'high', eventType: 'file.write' }),
    ]);

    const eventData = capturedTx.telemetryEvent.createMany.mock.calls[0][0].data;
    const alertData = capturedTx.alert.createMany.mock.calls[0][0].data;

    expect(alertData[0]).toMatchObject({
      ruleId: 'severity-threshold',
      telemetryEventId: eventData[0].id,
      severity: 'high',
      status: 'open',
      title: 'HIGH event: file.write',
      indicator: null,
    });
  });

  it('persists indicator when payload.fileHash is present', async () => {
    const hash = 'deadbeef'.repeat(8);
    await ingestTelemetryBatch('agent-a', 'tenant-a', [
      event({
        severity: 'critical',
        eventType: 'malware.detected',
        payload: { fileHash: hash },
      }),
    ]);

    const alertData = capturedTx.alert.createMany.mock.calls[0][0].data;
    expect(alertData[0].indicator).toBe(hash);
  });

  it('persists auth columns for auth.remote_logon events', async () => {
    await ingestTelemetryBatch('agent-a', 'tenant-a', [
      event({
        eventType: 'auth.remote_logon',
        severity: 'medium',
        payload: {
          account: 'jdoe',
          targetHost: 'workstation-1',
          sourceHost: 'jumpbox',
        },
      }),
    ]);

    const eventData = capturedTx.telemetryEvent.createMany.mock.calls[0][0].data;
    expect(eventData[0]).toMatchObject({
      authAccount: 'jdoe',
      authHost: 'workstation-1',
      authSourceHost: 'jumpbox',
      authGrantedTo: null,
    });
  });

  it('alert createMany runs inside the same transaction callback', async () => {
    await ingestTelemetryBatch('agent-a', 'tenant-a', [event({ severity: 'high' })]);

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(capturedTx.telemetryEvent.createMany).toHaveBeenCalled();
    expect(capturedTx.agent.update).toHaveBeenCalled();
    expect(capturedTx.alert.createMany).toHaveBeenCalled();
  });

  it('malware-prefix wins over severity-threshold for critical malware events', async () => {
    await ingestTelemetryBatch('agent-a', 'tenant-a', [
      event({ severity: 'critical', eventType: 'malware.detected' }),
    ]);

    const alertData = capturedTx.alert.createMany.mock.calls[0][0].data;
    expect(alertData[0]).toMatchObject({
      tenantId: 'tenant-a',
      agentId: 'agent-a',
      severity: 'high',
      status: 'open',
      ruleId: 'malware-prefix',
      title: 'Malware event: malware.detected',
    });
  });

  it('critical non-malware event uses severity-threshold ruleId', async () => {
    await ingestTelemetryBatch('agent-a', 'tenant-a', [
      event({ severity: 'critical', eventType: 'process.anomaly' }),
    ]);

    const alertData = capturedTx.alert.createMany.mock.calls[0][0].data;
    expect(alertData[0]).toMatchObject({
      tenantId: 'tenant-a',
      agentId: 'agent-a',
      severity: 'critical',
      status: 'open',
      ruleId: 'severity-threshold',
      title: 'CRITICAL event: process.anomaly',
    });
  });

  it('mixed batch creates per-event alerts for critical events only', async () => {
    await ingestTelemetryBatch('agent-a', 'tenant-a', [
      event({ severity: 'critical', eventType: 'a' }),
      event({ severity: 'critical', eventType: 'b' }),
      event({ severity: 'low', eventType: 'c' }),
      event({ severity: 'low', eventType: 'd' }),
      event({ severity: 'low', eventType: 'e' }),
    ]);

    const alertData = capturedTx.alert.createMany.mock.calls[0][0].data;
    const perEvent = alertData.filter((row: { telemetryEventId: string | null }) => row.telemetryEventId);
    expect(perEvent).toHaveLength(2);
    expect(perEvent.every((row: { ruleId: string }) => row.ruleId === 'severity-threshold')).toBe(true);
  });

  it('info / low / medium only does not call alert createMany', async () => {
    await ingestTelemetryBatch('agent-a', 'tenant-a', [
      event({ severity: 'info' }),
      event({ severity: 'low' }),
      event({ severity: 'medium' }),
    ]);

    expect(capturedTx.alert.createMany).not.toHaveBeenCalled();
    expect(logAuthEvent).not.toHaveBeenCalled();
  });

  it('malware-prefix ruleId on low severity malware events', async () => {
    await ingestTelemetryBatch('agent-a', 'tenant-a', [
      event({ severity: 'low', eventType: 'malware.trojan', payload: {} }),
    ]);

    const alertData = capturedTx.alert.createMany.mock.calls[0][0].data;
    expect(alertData[0]).toMatchObject({
      ruleId: 'malware-prefix',
      title: 'Malware event: malware.trojan',
      severity: 'high',
    });
  });

  it('batch burst adds burst alert with null telemetryEventId', async () => {
    await ingestTelemetryBatch('agent-a', 'tenant-a', [
      event({ severity: 'high', eventType: 'a' }),
      event({ severity: 'critical', eventType: 'b' }),
      event({ severity: 'high', eventType: 'c' }),
    ]);

    const alertData = capturedTx.alert.createMany.mock.calls[0][0].data;
    const perEvent = alertData.filter((row: { telemetryEventId: string | null }) => row.telemetryEventId);
    const burst = alertData.find((row: { ruleId: string }) => row.ruleId === 'batch-burst');
    expect(perEvent).toHaveLength(3);
    expect(burst).toMatchObject({
      telemetryEventId: null,
      ruleId: 'batch-burst',
      severity: 'critical',
      indicator: null,
    });
  });

  it('emits alert_created audit and metrics after commit', async () => {
    await ingestTelemetryBatch('agent-a', 'tenant-a', [event({ severity: 'high' })]);

    expect(logAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'alert_created',
        outcome: 'success',
        tenantId: 'tenant-a',
        agentId: 'agent-a',
        meta: expect.objectContaining({
          alertCount: 1,
          ruleIds: 'severity-threshold',
        }),
      })
    );
    expect(getMetricsSnapshot().alertsCreated).toBe(1);
  });

  it('alert createMany throws rejects the transaction', async () => {
    mockTransaction.mockImplementation(async (fn) => {
      capturedTx = {
        telemetryEvent: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
        agent: { update: jest.fn().mockResolvedValue({}) },
        alert: { createMany: jest.fn().mockRejectedValue(new Error('alert insert failed')) },
      };
      return fn(capturedTx);
    });

    await expect(
      ingestTelemetryBatch('agent-a', 'tenant-a', [event({ severity: 'high' })])
    ).rejects.toThrow('alert insert failed');

    expect(logAuthEvent).not.toHaveBeenCalled();
    expect(getMetricsSnapshot().alertsCreated).toBe(0);
  });

  it('telemetry createMany throws rejects and alert createMany is not called', async () => {
    mockTransaction.mockImplementation(async (fn) => {
      capturedTx = {
        telemetryEvent: {
          createMany: jest.fn().mockRejectedValue(new Error('telemetry insert failed')),
        },
        agent: { update: jest.fn().mockResolvedValue({}) },
        alert: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      };
      return fn(capturedTx);
    });

    await expect(
      ingestTelemetryBatch('agent-a', 'tenant-a', [event({ severity: 'high' })])
    ).rejects.toThrow('telemetry insert failed');

    expect(capturedTx.alert.createMany).not.toHaveBeenCalled();
  });
});
