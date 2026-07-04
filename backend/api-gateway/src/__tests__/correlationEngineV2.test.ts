import { detectOutbreaks, deriveOutbreakIncidentId } from '../lib/correlationEngineV2';
import { OutbreakAlertRow } from '../types/correlationIncident';

const TENANT = 'tenant-a';
const INDICATOR = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const REF = new Date('2026-06-15T12:00:00.000Z');
const WINDOW_MS = 24 * 60 * 60 * 1000;
const MIN_AGENTS = 3;
const OPTS = { windowMs: WINDOW_MS, minAgents: MIN_AGENTS };

function row(
  overrides: Partial<OutbreakAlertRow> & Pick<OutbreakAlertRow, 'id' | 'agentId' | 'createdAt'>
): OutbreakAlertRow {
  return {
    tenantId: TENANT,
    indicator: INDICATOR,
    ...overrides,
  };
}

describe('detectOutbreaks', () => {
  it('creates one incident when the same indicator appears on minAgents distinct agents within the window', () => {
    const base = new Date('2026-06-15T10:00:00.000Z');
    const alerts = [
      row({ id: 'a1', agentId: 'agent-1', createdAt: base }),
      row({ id: 'a2', agentId: 'agent-2', createdAt: new Date(base.getTime() + 60 * 60 * 1000) }),
      row({ id: 'a3', agentId: 'agent-3', createdAt: new Date(base.getTime() + 2 * 60 * 60 * 1000) }),
    ];

    const incidents = detectOutbreaks(alerts, OPTS, REF);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      tenantId: TENANT,
      type: 'malware_outbreak',
      indicator: INDICATOR,
      agentCount: 3,
    });
    expect(incidents[0].agentIds).toEqual(['agent-1', 'agent-2', 'agent-3']);
    expect(incidents[0].alertIds).toEqual(['a1', 'a2', 'a3']);
  });

  it('returns none when only minAgents - 1 distinct agents share the indicator', () => {
    const base = new Date('2026-06-15T10:00:00.000Z');
    const alerts = [
      row({ id: 'a1', agentId: 'agent-1', createdAt: base }),
      row({ id: 'a2', agentId: 'agent-2', createdAt: new Date(base.getTime() + 60 * 60 * 1000) }),
    ];

    expect(detectOutbreaks(alerts, OPTS, REF)).toHaveLength(0);
  });

  it('returns none when minAgents agents span longer than windowMs', () => {
    const alerts = [
      row({ id: 'a1', agentId: 'agent-1', createdAt: new Date('2026-06-14T10:00:00.000Z') }),
      row({ id: 'a2', agentId: 'agent-2', createdAt: new Date('2026-06-15T10:00:00.000Z') }),
      row({ id: 'a3', agentId: 'agent-3', createdAt: new Date('2026-06-15T11:00:01.000Z') }),
    ];

    expect(detectOutbreaks(alerts, OPTS, REF)).toHaveLength(0);
  });

  it('returns none when the same agent triggers minAgents alerts (only one distinct agent)', () => {
    const base = new Date('2026-06-15T10:00:00.000Z');
    const alerts = [
      row({ id: 'a1', agentId: 'agent-1', createdAt: base }),
      row({ id: 'a2', agentId: 'agent-1', createdAt: new Date(base.getTime() + 60 * 60 * 1000) }),
      row({ id: 'a3', agentId: 'agent-1', createdAt: new Date(base.getTime() + 2 * 60 * 60 * 1000) }),
    ];

    expect(detectOutbreaks(alerts, OPTS, REF)).toHaveLength(0);
  });

  it('ignores alerts with null indicator', () => {
    const base = new Date('2026-06-15T10:00:00.000Z');
    const alerts: OutbreakAlertRow[] = [
      row({ id: 'a1', agentId: 'agent-1', createdAt: base }),
      row({ id: 'a2', agentId: 'agent-2', createdAt: base, indicator: null }),
      row({ id: 'a3', agentId: 'agent-3', createdAt: base, indicator: '' }),
    ];

    expect(detectOutbreaks(alerts, OPTS, REF)).toHaveLength(0);
  });

  it('qualifies at the window boundary (span exactly windowMs)', () => {
    const start = new Date('2026-06-15T00:00:00.000Z');
    const end = new Date(start.getTime() + WINDOW_MS);
    const alerts = [
      row({ id: 'a1', agentId: 'agent-1', createdAt: start }),
      row({ id: 'a2', agentId: 'agent-2', createdAt: new Date(start.getTime() + WINDOW_MS / 2) }),
      row({ id: 'a3', agentId: 'agent-3', createdAt: end }),
    ];

    const incidents = detectOutbreaks(alerts, OPTS, REF);
    expect(incidents).toHaveLength(1);
    expect(incidents[0].agentCount).toBe(3);
  });

  it('returns identical incident id when run twice on the same input', () => {
    const base = new Date('2026-06-15T10:00:00.000Z');
    const alerts = [
      row({ id: 'a1', agentId: 'agent-1', createdAt: base }),
      row({ id: 'a2', agentId: 'agent-2', createdAt: new Date(base.getTime() + 30 * 60 * 1000) }),
      row({ id: 'a3', agentId: 'agent-3', createdAt: new Date(base.getTime() + 60 * 60 * 1000) }),
    ];

    const first = detectOutbreaks(alerts, OPTS, REF);
    const second = detectOutbreaks(alerts, OPTS, REF);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0].id).toBe(second[0].id);
    expect(first[0].id).toBe(
      deriveOutbreakIncidentId(TENANT, INDICATOR, first[0].firstSeen, WINDOW_MS)
    );
  });
});
