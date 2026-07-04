import { detectOutbreaks } from '../lib/correlationEngineV2';
import { prisma } from '../lib/prisma';
import { tenantWhere } from '../lib/tenantScope';
import {
  CorrelatedIncident,
  OUTBREAK_LOOKBACK_MS,
  OUTBREAK_MIN_AGENTS,
  OUTBREAK_WINDOW_MS,
  OutbreakAlertRow,
} from '../types/correlationIncident';

/**
 * Out-of-band outbreak detection for one tenant.
 *
 * Reads recent indicator-bearing alerts, runs pure v2 detection, and upserts
 * incidents by deterministic id (safe to call repeatedly — no duplicates).
 *
 * Scheduling (interval/worker/cron) is deferred; invoke manually or from tests.
 * Not wired into telemetry ingest.
 */
export async function runOutbreakDetection(tenantId: string): Promise<CorrelatedIncident[]> {
  const now = new Date();
  const lookbackStart = new Date(now.getTime() - OUTBREAK_LOOKBACK_MS);

  const alertRows = await prisma.alert.findMany({
    where: {
      ...tenantWhere(tenantId),
      indicator: { not: null },
      createdAt: { gte: lookbackStart },
    },
    select: {
      id: true,
      tenantId: true,
      agentId: true,
      indicator: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const rows: OutbreakAlertRow[] = alertRows.map((row) => ({
    id: row.id,
    tenantId: row.tenantId,
    agentId: row.agentId,
    indicator: row.indicator,
    createdAt: row.createdAt,
  }));

  const incidents = detectOutbreaks(
    rows,
    { windowMs: OUTBREAK_WINDOW_MS, minAgents: OUTBREAK_MIN_AGENTS },
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
