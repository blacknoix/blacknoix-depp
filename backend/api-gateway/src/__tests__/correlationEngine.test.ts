import { DEFAULT_RULES, evaluateRules } from '../lib/correlationEngine';
import { CorrelationRule, TelemetryEventRow } from '../types/correlationRule';

const context = { tenantId: 'tenant-a', agentId: 'agent-a' };

function row(overrides: Partial<TelemetryEventRow> & Pick<TelemetryEventRow, 'id'>): TelemetryEventRow {
  return {
    tenantId: 'tenant-a',
    agentId: 'agent-a',
    eventType: 'process.start',
    severity: 'low',
    occurredAt: new Date('2024-06-01T12:00:00.000Z'),
    payload: {},
    ...overrides,
  };
}

describe('evaluateRules', () => {
  it('severity-threshold matches high events', () => {
    const alerts = evaluateRules([row({ id: 'e1', severity: 'high', eventType: 'file.write' })], context);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      ruleId: 'severity-threshold',
      telemetryEventId: 'e1',
      severity: 'high',
      title: 'HIGH event: file.write',
    });
  });

  it('severity-threshold matches critical events', () => {
    const alerts = evaluateRules(
      [row({ id: 'e1', severity: 'critical', eventType: 'process.anomaly' })],
      context
    );
    expect(alerts[0]).toMatchObject({
      ruleId: 'severity-threshold',
      severity: 'critical',
    });
  });

  it('malware-prefix matches malware.* at any severity', () => {
    const alerts = evaluateRules(
      [row({ id: 'e1', severity: 'low', eventType: 'malware.trojan' })],
      context
    );
    expect(alerts[0]).toMatchObject({
      ruleId: 'malware-prefix',
      severity: 'high',
      title: 'Malware event: malware.trojan',
      indicator: null,
    });
  });

  it('populates indicator from payload.fileHash when present', () => {
    const hash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const alerts = evaluateRules(
      [
        row({
          id: 'e1',
          severity: 'critical',
          eventType: 'malware.detected',
          payload: { fileHash: hash },
        }),
      ],
      context
    );
    expect(alerts[0].indicator).toBe(hash);
  });

  it('malware-prefix wins over severity-threshold for critical malware events', () => {
    const alerts = evaluateRules(
      [row({ id: 'e1', severity: 'critical', eventType: 'malware.detected' })],
      context
    );
    const perEvent = alerts.filter((a) => a.telemetryEventId);
    expect(perEvent).toHaveLength(1);
    expect(perEvent[0].ruleId).toBe('malware-prefix');
    expect(perEvent[0].severity).toBe('high');
  });

  it('first-rule-wins: each event claimed at most once', () => {
    const alerts = evaluateRules(
      [
        row({ id: 'e1', severity: 'high', eventType: 'a' }),
        row({ id: 'e2', severity: 'critical', eventType: 'b' }),
        row({ id: 'e3', severity: 'high', eventType: 'c' }),
      ],
      context
    );
    const perEvent = alerts.filter((a) => a.telemetryEventId);
    expect(perEvent).toHaveLength(3);
    expect(new Set(perEvent.map((a) => a.telemetryEventId)).size).toBe(3);
    expect(alerts.filter((a) => a.ruleId === 'severity-threshold')).toHaveLength(3);
  });

  it('batch-burst adds synthetic alert with null telemetryEventId', () => {
    const alerts = evaluateRules(
      [
        row({ id: 'e1', severity: 'high', eventType: 'a' }),
        row({ id: 'e2', severity: 'critical', eventType: 'b' }),
        row({ id: 'e3', severity: 'high', eventType: 'c' }),
      ],
      context
    );
    const burst = alerts.find((a) => a.ruleId === 'batch-burst');
    expect(burst).toBeDefined();
    expect(burst!.telemetryEventId).toBeNull();
    expect(burst!.indicator).toBeNull();
    expect(burst!.title).toContain('3');
    expect(alerts.filter((a) => a.telemetryEventId)).toHaveLength(3);
  });

  it('batch-burst does not fire below minCount', () => {
    const alerts = evaluateRules(
      [
        row({ id: 'e1', severity: 'high', eventType: 'a' }),
        row({ id: 'e2', severity: 'critical', eventType: 'b' }),
      ],
      context
    );
    expect(alerts.every((a) => a.ruleId !== 'batch-burst')).toBe(true);
  });

  it('severity-threshold skips malware.* even when malware-prefix is disabled', () => {
    const rules: CorrelationRule[] = DEFAULT_RULES.map((r) =>
      r.id === 'malware-prefix' ? { ...r, enabled: false } : r
    );
    const alerts = evaluateRules(
      [row({ id: 'e1', severity: 'critical', eventType: 'malware.detected' })],
      context,
      rules
    );
    expect(alerts.filter((a) => a.telemetryEventId)).toHaveLength(0);
  });

  it('disabled rules are skipped', () => {
    const rules: CorrelationRule[] = DEFAULT_RULES.map((r) =>
      r.id === 'severity-threshold' ? { ...r, enabled: false } : r
    );
    const alerts = evaluateRules(
      [row({ id: 'e1', severity: 'high', eventType: 'file.write' })],
      context,
      rules
    );
    expect(alerts).toHaveLength(0);
  });

  it('empty input returns no alerts', () => {
    expect(evaluateRules([], context)).toEqual([]);
  });
});
