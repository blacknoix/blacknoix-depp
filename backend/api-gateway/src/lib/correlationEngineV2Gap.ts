import { createHash } from 'crypto';
import {
  CorrelatedIncident,
  TelemetryGapDetectionOptions,
  TelemetryGapEvaluationInput,
} from '../types/correlationIncident';

const INCIDENT_TYPE = 'telemetry_gap_after_alert' as const;

/**
 * Deterministic incident id for idempotent persistence.
 * Key: tenantId | agentId | gap window bucket (floor(alertTime / gapWindowMs) * gapWindowMs).
 */
export function deriveTelemetryGapIncidentId(
  tenantId: string,
  agentId: string,
  alertTime: Date,
  gapWindowMs: number
): string {
  const windowBucketStart = Math.floor(alertTime.getTime() / gapWindowMs) * gapWindowMs;
  const material = `${tenantId}|${agentId}|${windowBucketStart}`;
  return createHash('sha256').update(material).digest('hex');
}

export function gapWindowHours(gapWindowMs: number): number {
  return gapWindowMs / (60 * 60 * 1000);
}

export function eventsPerHour(eventCount: number, windowMs: number): number {
  if (windowMs <= 0) {
    return 0;
  }
  return eventCount / (windowMs / (60 * 60 * 1000));
}

export function isVolumeDegraded(
  baselineEventsPerHour: number,
  gapObservedCount: number,
  gapWindowMs: number,
  dropThresholdFraction: number
): boolean {
  if (baselineEventsPerHour <= 0) {
    return false;
  }
  const gapRate = eventsPerHour(gapObservedCount, gapWindowMs);
  return gapRate < baselineEventsPerHour * dropThresholdFraction;
}

function evaluatePeerClassification(
  peers: TelemetryGapEvaluationInput['peers'],
  gapWindowMs: number,
  dropThresholdFraction: number
): { degradedCount: number; normalCount: number; degradedFraction: number } {
  let degradedCount = 0;
  let normalCount = 0;

  for (const peer of peers) {
    const degraded = isVolumeDegraded(
      peer.baselineEventsPerHour,
      peer.gapObservedCount,
      gapWindowMs,
      dropThresholdFraction
    );
    if (degraded) {
      degradedCount += 1;
    } else if (peer.baselineEventsPerHour > 0) {
      normalCount += 1;
    }
  }

  const totalPeers = peers.length;
  const degradedFraction = totalPeers > 0 ? degradedCount / totalPeers : 0;
  return { degradedCount, normalCount, degradedFraction };
}

function shouldFireByPeerRules(
  input: TelemetryGapEvaluationInput,
  opts: TelemetryGapDetectionOptions,
  degradedFraction: number,
  normalPeerCount: number
): boolean {
  if (input.totalTenantAgentCount < opts.smallFleetSize) {
    return normalPeerCount >= opts.smallFleetMinNormal;
  }

  if (degradedFraction >= opts.maxPeerDegradedFraction) {
    return false;
  }

  if (degradedFraction < opts.minPeerNormalFraction) {
    return true;
  }

  return false;
}

/**
 * Pure telemetry-gap decision after a high/critical alert.
 * Returns null when gap check fails, peers indicate shared outage, or small-fleet floor not met.
 */
export function evaluateTelemetryGap(
  input: TelemetryGapEvaluationInput,
  opts: TelemetryGapDetectionOptions,
  referenceTime: Date = new Date()
): CorrelatedIncident | null {
  if (
    !isVolumeDegraded(
      input.agentBaselineEventsPerHour,
      input.agentGapObservedCount,
      opts.gapWindowMs,
      opts.dropThresholdFraction
    )
  ) {
    return null;
  }

  const { degradedFraction, normalCount } = evaluatePeerClassification(
    input.peers,
    opts.gapWindowMs,
    opts.dropThresholdFraction
  );

  if (
    !shouldFireByPeerRules(input, opts, degradedFraction, normalCount)
  ) {
    return null;
  }

  const gapEnd = new Date(input.alertTime.getTime() + opts.gapWindowMs);
  const id = deriveTelemetryGapIncidentId(
    input.tenantId,
    input.agentId,
    input.alertTime,
    opts.gapWindowMs
  );

  return {
    id,
    tenantId: input.tenantId,
    type: INCIDENT_TYPE,
    indicator: input.agentId,
    agentIds: [input.agentId],
    alertIds: [input.alertId],
    firstSeen: input.alertTime,
    lastSeen: gapEnd,
    baselineVolume: input.agentBaselineEventsPerHour,
    observedVolume: input.agentGapObservedCount,
    degradedPeerFraction: degradedFraction,
    agentCount: 1,
    createdAt: referenceTime,
  };
}

/**
 * Evaluate multiple alert triggers; returns incidents in stable order.
 */
export function detectTelemetryGaps(
  inputs: TelemetryGapEvaluationInput[],
  opts: TelemetryGapDetectionOptions,
  referenceTime: Date = new Date()
): CorrelatedIncident[] {
  const incidents: CorrelatedIncident[] = [];

  for (const input of inputs) {
    const incident = evaluateTelemetryGap(input, opts, referenceTime);
    if (incident) {
      incidents.push(incident);
    }
  }

  incidents.sort((a, b) => {
    if (a.tenantId !== b.tenantId) {
      return a.tenantId.localeCompare(b.tenantId);
    }
    if (a.indicator !== b.indicator) {
      return a.indicator.localeCompare(b.indicator);
    }
    return a.firstSeen.getTime() - b.firstSeen.getTime();
  });

  return incidents;
}
