import {
  detectLateralMovement,
  deriveLateralIncidentId,
} from '../lib/correlationEngineV2Lateral';
import {
  AUTH_PRIVILEGE_CHANGE_EVENT_TYPE,
  AUTH_REMOTE_LOGON_EVENT_TYPE,
} from '../types/authTelemetry';
import { AuthTelemetryRow } from '../types/correlationIncident';

const TENANT = 'tenant-a';
const ACCOUNT = 'CORP\\jdoe';
const REF = new Date('2026-06-15T12:00:00.000Z');
const HOST_WINDOW_MS = 30 * 60 * 1000;
const ESCALATION_MS = 15 * 60 * 1000;
const MIN_HOSTS = 3;
const OPTS = {
  hostWindowMs: HOST_WINDOW_MS,
  minHosts: MIN_HOSTS,
  escalationWindowMs: ESCALATION_MS,
};

function logon(
  overrides: Partial<AuthTelemetryRow> & Pick<AuthTelemetryRow, 'id' | 'authHost' | 'occurredAt'>
): AuthTelemetryRow {
  return {
    tenantId: TENANT,
    agentId: 'agent-1',
    eventType: AUTH_REMOTE_LOGON_EVENT_TYPE,
    authAccount: ACCOUNT,
    ...overrides,
  };
}

function privilege(
  overrides: Partial<AuthTelemetryRow> & Pick<AuthTelemetryRow, 'id' | 'occurredAt'>
): AuthTelemetryRow {
  return {
    tenantId: TENANT,
    agentId: 'agent-1',
    eventType: AUTH_PRIVILEGE_CHANGE_EVENT_TYPE,
    authAccount: ACCOUNT,
    authHost: 'host-a',
    ...overrides,
  };
}

describe('detectLateralMovement', () => {
  it('creates one incident when minHosts are reached then privilege_change follows within W2', () => {
    const base = new Date('2026-06-15T10:00:00.000Z');
    const events: AuthTelemetryRow[] = [
      logon({ id: 'l1', authHost: 'host-a', occurredAt: base }),
      logon({
        id: 'l2',
        authHost: 'host-b',
        occurredAt: new Date(base.getTime() + 5 * 60 * 1000),
      }),
      logon({
        id: 'l3',
        authHost: 'host-c',
        occurredAt: new Date(base.getTime() + 10 * 60 * 1000),
      }),
      privilege({
        id: 'p1',
        occurredAt: new Date(base.getTime() + 12 * 60 * 1000),
      }),
    ];

    const incidents = detectLateralMovement(events, OPTS, REF);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      tenantId: TENANT,
      type: 'lateral_movement_privilege_escalation',
      indicator: ACCOUNT,
      agentCount: 3,
    });
    expect(incidents[0].agentIds).toEqual(['host-a', 'host-b', 'host-c']);
    expect(incidents[0].alertIds).toEqual(['l1', 'l2', 'l3', 'p1']);
    expect(incidents[0].escalatedAt).toEqual(incidents[0].lastSeen);
  });

  it('returns none when only minHosts - 1 distinct hosts are reached', () => {
    const base = new Date('2026-06-15T10:00:00.000Z');
    const events: AuthTelemetryRow[] = [
      logon({ id: 'l1', authHost: 'host-a', occurredAt: base }),
      logon({ id: 'l2', authHost: 'host-b', occurredAt: base }),
      privilege({ id: 'p1', occurredAt: new Date(base.getTime() + 5 * 60 * 1000) }),
    ];

    expect(detectLateralMovement(events, OPTS, REF)).toHaveLength(0);
  });

  it('returns none when privilege_change occurs after the follow-up window', () => {
    const base = new Date('2026-06-15T10:00:00.000Z');
    const lastLogon = new Date(base.getTime() + 10 * 60 * 1000);
    const events: AuthTelemetryRow[] = [
      logon({ id: 'l1', authHost: 'host-a', occurredAt: base }),
      logon({ id: 'l2', authHost: 'host-b', occurredAt: new Date(base.getTime() + 5 * 60 * 1000) }),
      logon({ id: 'l3', authHost: 'host-c', occurredAt: lastLogon }),
      privilege({
        id: 'p1',
        occurredAt: new Date(lastLogon.getTime() + ESCALATION_MS + 1),
      }),
    ];

    expect(detectLateralMovement(events, OPTS, REF)).toHaveLength(0);
  });

  it('returns none when minHosts are reached but no privilege_change exists (false-positive guard)', () => {
    const base = new Date('2026-06-15T10:00:00.000Z');
    const events: AuthTelemetryRow[] = [
      logon({ id: 'l1', authHost: 'host-a', occurredAt: base }),
      logon({ id: 'l2', authHost: 'host-b', occurredAt: new Date(base.getTime() + 5 * 60 * 1000) }),
      logon({ id: 'l3', authHost: 'host-c', occurredAt: new Date(base.getTime() + 10 * 60 * 1000) }),
    ];

    expect(detectLateralMovement(events, OPTS, REF)).toHaveLength(0);
  });

  it('qualifies at host window and escalation follow-up boundaries', () => {
    const start = new Date('2026-06-15T10:00:00.000Z');
    const lastLogon = new Date(start.getTime() + HOST_WINDOW_MS);
    const events: AuthTelemetryRow[] = [
      logon({ id: 'l1', authHost: 'host-a', occurredAt: start }),
      logon({
        id: 'l2',
        authHost: 'host-b',
        occurredAt: new Date(start.getTime() + HOST_WINDOW_MS / 2),
      }),
      logon({ id: 'l3', authHost: 'host-c', occurredAt: lastLogon }),
      privilege({ id: 'p1', occurredAt: new Date(lastLogon.getTime() + ESCALATION_MS) }),
    ];

    const incidents = detectLateralMovement(events, OPTS, REF);
    expect(incidents).toHaveLength(1);
    expect(incidents[0].agentCount).toBe(3);
  });

  it('returns identical incident id when run twice on the same input', () => {
    const base = new Date('2026-06-15T10:00:00.000Z');
    const events: AuthTelemetryRow[] = [
      logon({ id: 'l1', authHost: 'host-a', occurredAt: base }),
      logon({ id: 'l2', authHost: 'host-b', occurredAt: new Date(base.getTime() + 5 * 60 * 1000) }),
      logon({ id: 'l3', authHost: 'host-c', occurredAt: new Date(base.getTime() + 10 * 60 * 1000) }),
      privilege({ id: 'p1', occurredAt: new Date(base.getTime() + 12 * 60 * 1000) }),
    ];

    const first = detectLateralMovement(events, OPTS, REF);
    const second = detectLateralMovement(events, OPTS, REF);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0].id).toBe(second[0].id);
    expect(first[0].id).toBe(
      deriveLateralIncidentId(TENANT, ACCOUNT, first[0].firstSeen, HOST_WINDOW_MS)
    );
  });
});
