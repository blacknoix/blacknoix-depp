import {
  detectTelemetryGaps,
  eventsPerHour,
} from '../lib/correlationEngineV2Gap';
import { prisma } from '../lib/prisma';
import { tenantWhere } from '../lib/tenantScope';
import {
  CorrelatedIncident,
  DROP_THRESHOLD_FRACTION,
  GAP_ALERT_LOOKBACK_MS,
  GAP_BASELINE_LOOKBACK_MS,
  GAP_WINDOW_MS,
  MAX_PEER_DEGRADED_FRACTION,
  MIN_PEER_NORMAL_FRACTION,
  SMALL_FLEET_MIN_NORMAL,
  SMALL_FLEET_SIZE,
  TELEMETRY_GAP_TRIGGER_SEVERITIES,
  TelemetryGapEvaluationInput,
  TelemetryGapPeerVolume,
} from '../types/correlationIncident';

async function countTelemetryEvents(
  tenantId: string,
  agentId: string,
  since: Date,
  until: Date
): Promise<number> {
  return prisma.telemetryEvent.count({
    where: {
      tenantId,
      agentId,
      occurredAt: { gte: since, lt: until },
    },
  });
}

/**
 * Out-of-band telemetry-gap detection for one tenant.
 *
 * Finds recent high/critical alerts whose gap window has elapsed, compares each
 * triggering agent's volume drop against peer baselines, and upserts incidents
 * by deterministic id (safe to call repeatedly — no duplicates).
 *
 * Uses existing TelemetryEvent and Alert data — no new agent telemetry required.
 * Threshold constants are first-guess defaults; tune on real tenant data.
 *
 * Scheduling deferred; not wired into telemetry ingest.
 */
export async function runTelemetryGapDetection(
  tenantId: string
): Promise<CorrelatedIncident[]> {
  const now = new Date();
  const alertLookbackStart = new Date(now.getTime() - GAP_ALERT_LOOKBACK_MS);
  const gapWindowEndCutoff = new Date(now.getTime() - GAP_WINDOW_MS);

  const alerts = await prisma.alert.findMany({
    where: {
      ...tenantWhere(tenantId),
      severity: { in: [...TELEMETRY_GAP_TRIGGER_SEVERITIES] },
      createdAt: {
        gte: alertLookbackStart,
        lte: gapWindowEndCutoff,
      },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      tenantId: true,
      agentId: true,
      createdAt: true,
    },
  });

  if (alerts.length === 0) {
    return [];
  }

  const agents = await prisma.agent.findMany({
    where: tenantWhere(tenantId),
    select: { id: true },
  });
  const agentIds = agents.map((agent) => agent.id);
  const inputs: TelemetryGapEvaluationInput[] = [];

  for (const alert of alerts) {
    const alertTime = alert.createdAt;
    const baselineStart = new Date(alertTime.getTime() - GAP_BASELINE_LOOKBACK_MS);
    const gapEnd = new Date(alertTime.getTime() + GAP_WINDOW_MS);

    const baselineCount = await countTelemetryEvents(
      tenantId,
      alert.agentId,
      baselineStart,
      alertTime
    );
    const agentBaselineEventsPerHour = eventsPerHour(
      baselineCount,
      GAP_BASELINE_LOOKBACK_MS
    );

    if (agentBaselineEventsPerHour <= 0) {
      continue;
    }

    const agentGapObservedCount = await countTelemetryEvents(
      tenantId,
      alert.agentId,
      alertTime,
      gapEnd
    );

    const peers: TelemetryGapPeerVolume[] = [];
    for (const peerId of agentIds) {
      if (peerId === alert.agentId) {
        continue;
      }

      const peerBaselineCount = await countTelemetryEvents(
        tenantId,
        peerId,
        baselineStart,
        alertTime
      );
      const peerGapCount = await countTelemetryEvents(
        tenantId,
        peerId,
        alertTime,
        gapEnd
      );

      peers.push({
        agentId: peerId,
        baselineEventsPerHour: eventsPerHour(peerBaselineCount, GAP_BASELINE_LOOKBACK_MS),
        gapObservedCount: peerGapCount,
      });
    }

    inputs.push({
      tenantId,
      alertId: alert.id,
      agentId: alert.agentId,
      alertTime,
      agentBaselineEventsPerHour,
      agentGapObservedCount,
      peers,
      totalTenantAgentCount: agentIds.length,
    });
  }

  const incidents = detectTelemetryGaps(
    inputs,
    {
      gapWindowMs: GAP_WINDOW_MS,
      dropThresholdFraction: DROP_THRESHOLD_FRACTION,
      minPeerNormalFraction: MIN_PEER_NORMAL_FRACTION,
      maxPeerDegradedFraction: MAX_PEER_DEGRADED_FRACTION,
      smallFleetSize: SMALL_FLEET_SIZE,
      smallFleetMinNormal: SMALL_FLEET_MIN_NORMAL,
    },
    now
  );

  for (const incident of incidents) {
    await prisma.correlatedIncident.upsert({
      where: { id: incident.id },
      create: {
        id: incident.id,
        tenantId: incident.tenantId,
        type: incident.type,
        indicator: incident.indicator,
        agentIds: incident.agentIds,
        alertIds: incident.alertIds,
        agentCount: incident.agentCount,
        firstSeen: incident.firstSeen,
        lastSeen: incident.lastSeen,
        createdAt: incident.createdAt,
      },
      update: {
        agentIds: incident.agentIds,
        alertIds: incident.alertIds,
        agentCount: incident.agentCount,
        firstSeen: incident.firstSeen,
        lastSeen: incident.lastSeen,
      },
    });
  }

  return incidents;
}
