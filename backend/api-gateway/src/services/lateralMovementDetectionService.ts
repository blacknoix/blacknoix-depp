import { detectLateralMovement } from '../lib/correlationEngineV2Lateral';
import { listAuthTelemetryForTenant } from './telemetryService';
import { prisma } from '../lib/prisma';
import {
  AuthTelemetryRow,
  CorrelatedIncident,
  ESCALATION_FOLLOWUP_MS,
  LATERAL_LOOKBACK_MS,
  LATERAL_MIN_HOSTS,
  LATERAL_WINDOW_MS,
} from '../types/correlationIncident';

/**
 * Out-of-band lateral-movement + privilege-escalation detection for one tenant.
 *
 * Reads recent auth telemetry, runs pure v2 detection, and upserts incidents by
 * deterministic id (safe to call repeatedly — no duplicates).
 *
 * Scheduling (interval/worker/cron) is deferred; invoke manually or from tests.
 * Not wired into telemetry ingest.
 */
export async function runLateralMovementDetection(
  tenantId: string
): Promise<CorrelatedIncident[]> {
  const now = new Date();
  const lookbackStart = new Date(now.getTime() - LATERAL_LOOKBACK_MS);

  const events = await listAuthTelemetryForTenant(tenantId, {
    since: lookbackStart,
    limit: 500,
  });

  const rows: AuthTelemetryRow[] = events
    .filter((row) => row.authAccount !== null)
    .map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      agentId: row.agentId,
      eventType: row.eventType,
      authAccount: row.authAccount!,
      authHost: row.authHost,
      occurredAt: row.occurredAt,
    }));

  const incidents = detectLateralMovement(
    rows,
    {
      hostWindowMs: LATERAL_WINDOW_MS,
      minHosts: LATERAL_MIN_HOSTS,
      escalationWindowMs: ESCALATION_FOLLOWUP_MS,
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
