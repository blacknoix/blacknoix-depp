import { ingestTelemetryBatch } from '../services/telemetryService';
import { TelemetryEventInput } from '../types/telemetry';

let capturedTx: {
  telemetryEvent: { createMany: jest.Mock };
  agent: { update: jest.Mock };
  alert: { createMany: jest.Mock };
};

const mockTransaction = jest.fn();

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
  it('high-severity event calls telemetry createMany before alert createMany', async () => {
    const callOrder: string[] = [];
    mockTransaction.mockImplementation(async (fn) => {
      capturedTx = {
        telemetryEvent: {
          createMany: jest.fn().mockImplementation(async () => {
            callOrder.push('telemetry');
            return { count: 1 };
          }),
        },
        agent: { update: jest.fn().mockResolvedValue({}) },
        alert: {
          createMany: jest.fn().mockImplementation(async () => {
            callOrder.push('alert');
            return { count: 1 };
          }),
        },
      };
      return fn(capturedTx);
    });

    await ingestTelemetryBatch('agent-a', 'tenant-a', [event({ severity: 'high' })]);

    expect(callOrder).toEqual(['telemetry', 'alert']);
  });

  it('high-severity alert telemetryEventId matches pre-generated event id', async () => {
    await ingestTelemetryBatch('agent-a', 'tenant-a', [
      event({ severity: 'high', eventType: 'file.write' }),
    ]);

    const eventData = capturedTx.telemetryEvent.createMany.mock.calls[0][0].data;
    const alertData = capturedTx.alert.createMany.mock.calls[0][0].data;

    expect(eventData).toHaveLength(1);
    expect(alertData).toHaveLength(1);
    expect(alertData[0].telemetryEventId).toBe(eventData[0].id);
    expect(eventData[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it('high-severity alert createMany runs inside the same transaction callback', async () => {
    await ingestTelemetryBatch('agent-a', 'tenant-a', [event({ severity: 'high' })]);

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(capturedTx.telemetryEvent.createMany).toHaveBeenCalled();
    expect(capturedTx.agent.update).toHaveBeenCalled();
    expect(capturedTx.alert.createMany).toHaveBeenCalled();
  });

  it('critical event creates alert with severity critical and status open', async () => {
    await ingestTelemetryBatch('agent-a', 'tenant-a', [
      event({ severity: 'critical', eventType: 'malware.detected' }),
    ]);

    const alertData = capturedTx.alert.createMany.mock.calls[0][0].data;
    expect(alertData[0]).toMatchObject({
      tenantId: 'tenant-a',
      agentId: 'agent-a',
      severity: 'critical',
      status: 'open',
      title: 'CRITICAL event: malware.detected',
    });
  });

  it('mixed batch creates alerts for critical events only in one createMany call', async () => {
    await ingestTelemetryBatch('agent-a', 'tenant-a', [
      event({ severity: 'critical', eventType: 'a' }),
      event({ severity: 'critical', eventType: 'b' }),
      event({ severity: 'low', eventType: 'c' }),
      event({ severity: 'low', eventType: 'd' }),
      event({ severity: 'low', eventType: 'e' }),
    ]);

    expect(capturedTx.alert.createMany).toHaveBeenCalledTimes(1);
    const alertData = capturedTx.alert.createMany.mock.calls[0][0].data;
    expect(alertData).toHaveLength(2);
    expect(alertData.every((row: { severity: string }) => row.severity === 'critical')).toBe(true);
  });

  it('info / low / medium only does not call alert createMany', async () => {
    await ingestTelemetryBatch('agent-a', 'tenant-a', [
      event({ severity: 'info' }),
      event({ severity: 'low' }),
      event({ severity: 'medium' }),
    ]);

    expect(capturedTx.alert.createMany).not.toHaveBeenCalled();
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
