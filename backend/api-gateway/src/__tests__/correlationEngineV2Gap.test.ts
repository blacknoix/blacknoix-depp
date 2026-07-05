import {
  deriveTelemetryGapIncidentId,
  detectTelemetryGaps,
  evaluateTelemetryGap,
} from '../lib/correlationEngineV2Gap';
import {
  DROP_THRESHOLD_FRACTION,
  GAP_WINDOW_MS,
  MAX_PEER_DEGRADED_FRACTION,
  MIN_PEER_NORMAL_FRACTION,
  SMALL_FLEET_MIN_NORMAL,
  SMALL_FLEET_SIZE,
  TelemetryGapEvaluationInput,
  TelemetryGapDetectionOptions,
} from '../types/correlationIncident';

const TENANT = 'tenant-a';
const AGENT = 'agent-trigger';
const ALERT = 'alert-1';
const REF = new Date('2026-06-15T12:00:00.000Z');
const ALERT_TIME = new Date('2026-06-15T10:00:00.000Z');
const BASELINE_RATE = 10;

const OPTS: TelemetryGapDetectionOptions = {
  gapWindowMs: GAP_WINDOW_MS,
  dropThresholdFraction: DROP_THRESHOLD_FRACTION,
  minPeerNormalFraction: MIN_PEER_NORMAL_FRACTION,
  maxPeerDegradedFraction: MAX_PEER_DEGRADED_FRACTION,
  smallFleetSize: SMALL_FLEET_SIZE,
  smallFleetMinNormal: SMALL_FLEET_MIN_NORMAL,
};

function normalPeer(id: string): { agentId: string; baselineEventsPerHour: number; gapObservedCount: number } {
  return {
    agentId: id,
    baselineEventsPerHour: BASELINE_RATE,
    gapObservedCount: 4,
  };
}

function degradedPeer(id: string): { agentId: string; baselineEventsPerHour: number; gapObservedCount: number } {
  return {
    agentId: id,
    baselineEventsPerHour: BASELINE_RATE,
    gapObservedCount: 0,
  };
}

function input(
  overrides: Partial<TelemetryGapEvaluationInput> = {}
): TelemetryGapEvaluationInput {
  return {
    tenantId: TENANT,
    alertId: ALERT,
    agentId: AGENT,
    alertTime: ALERT_TIME,
    agentBaselineEventsPerHour: BASELINE_RATE,
    agentGapObservedCount: 0,
    peers: [
      normalPeer('peer-1'),
      normalPeer('peer-2'),
      normalPeer('peer-3'),
      normalPeer('peer-4'),
      normalPeer('peer-5'),
    ],
    totalTenantAgentCount: 6,
    ...overrides,
  };
}

describe('evaluateTelemetryGap', () => {
  it('fires when the triggering agent is degraded and peers are mostly normal', () => {
    const incident = evaluateTelemetryGap(input(), OPTS, REF);
    expect(incident).not.toBeNull();
    expect(incident).toMatchObject({
      type: 'telemetry_gap_after_alert',
      indicator: AGENT,
      alertIds: [ALERT],
      baselineVolume: BASELINE_RATE,
      observedVolume: 0,
      degradedPeerFraction: 0,
    });
  });

  it('suppresses when most peers are also degraded (shared outage)', () => {
    const incident = evaluateTelemetryGap(
      input({
        peers: [
          degradedPeer('peer-1'),
          degradedPeer('peer-2'),
          degradedPeer('peer-3'),
          normalPeer('peer-4'),
          normalPeer('peer-5'),
        ],
      }),
      OPTS,
      REF
    );
    expect(incident).toBeNull();
  });

  it('suppresses in the ambiguous band between ratio thresholds', () => {
    const incident = evaluateTelemetryGap(
      input({
        peers: [
          degradedPeer('peer-1'),
          degradedPeer('peer-2'),
          normalPeer('peer-3'),
          normalPeer('peer-4'),
          normalPeer('peer-5'),
        ],
      }),
      OPTS,
      REF
    );
    expect(incident).toBeNull();
  });

  it('suppresses on small fleet when absolute normal-peer floor is not met', () => {
    const incident = evaluateTelemetryGap(
      input({
        totalTenantAgentCount: 4,
        peers: [normalPeer('peer-1'), degradedPeer('peer-2'), degradedPeer('peer-3')],
      }),
      OPTS,
      REF
    );
    expect(incident).toBeNull();
  });

  it('fires on small fleet when enough other agents are clearly normal', () => {
    const incident = evaluateTelemetryGap(
      input({
        totalTenantAgentCount: 4,
        peers: [normalPeer('peer-1'), normalPeer('peer-2'), degradedPeer('peer-3')],
      }),
      OPTS,
      REF
    );
    expect(incident).not.toBeNull();
  });

  it('returns none when the triggering agent is not degraded', () => {
    const incident = evaluateTelemetryGap(
      input({ agentGapObservedCount: 4 }),
      OPTS,
      REF
    );
    expect(incident).toBeNull();
  });

  it('fires at the ratio boundary when degradedPeerFraction is just below MIN_PEER_NORMAL_FRACTION', () => {
    const incident = evaluateTelemetryGap(
      input({
        peers: [
          degradedPeer('peer-1'),
          normalPeer('peer-2'),
          normalPeer('peer-3'),
          normalPeer('peer-4'),
          normalPeer('peer-5'),
        ],
      }),
      OPTS,
      REF
    );
    expect(incident).not.toBeNull();
    expect(incident!.degradedPeerFraction).toBe(0.2);
  });

  it('returns identical incident id when run twice on the same input', () => {
    const first = detectTelemetryGaps([input()], OPTS, REF);
    const second = detectTelemetryGaps([input()], OPTS, REF);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0].id).toBe(second[0].id);
    expect(first[0].id).toBe(
      deriveTelemetryGapIncidentId(TENANT, AGENT, ALERT_TIME, GAP_WINDOW_MS)
    );
  });
});
