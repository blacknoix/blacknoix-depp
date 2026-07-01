import { prisma } from '../lib/prisma';
import { tenantWhere } from '../lib/tenantScope';
import { getTenantProfile } from './tenantService';
import {
  emptyAgentStatusCounts,
  emptyAlertSeverityCounts,
  emptyAlertStatusCounts,
  TENANT_OVERVIEW_WINDOW_MS,
  TenantOverview,
} from '../types/tenantOverview';

function toIsoOrNull(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function foldGroupBy<T extends string>(
  rows: Array<{ _count: { _all: number }; [key: string]: unknown }>,
  keyField: string,
  empty: Record<T, number>
): { counts: Record<T, number>; total: number } {
  const counts = { ...empty };
  let total = 0;
  for (const row of rows) {
    const key = row[keyField] as T;
    const count = row._count._all;
    if (key in counts) {
      counts[key] = count;
      total += count;
    }
  }
  return { counts, total };
}

/**
 * Aggregate tenant dashboard metrics — read-only, tenant-scoped, no side effects.
 * Returns null when the tenant does not exist.
 */
export async function getTenantOverview(tenantId: string): Promise<TenantOverview | null> {
  const tenant = await getTenantProfile(tenantId);
  if (!tenant) {
    return null;
  }

  const generatedAt = new Date();
  const windowStart = new Date(generatedAt.getTime() - TENANT_OVERVIEW_WINDOW_MS);
  const scope = tenantWhere(tenantId);

  const [
    agentStatusGroups,
    recentlySeen,
    alertStatusGroups,
    alertSeverityGroups,
    events24h,
    latestTelemetry,
    latestAlert,
    latestAgentSeen,
  ] = await Promise.all([
    prisma.agent.groupBy({
      by: ['status'],
      where: scope,
      _count: { _all: true },
    }),
    prisma.agent.count({
      where: {
        ...scope,
        lastSeenAt: { gte: windowStart },
      },
    }),
    prisma.alert.groupBy({
      by: ['status'],
      where: scope,
      _count: { _all: true },
    }),
    prisma.alert.groupBy({
      by: ['severity'],
      where: scope,
      _count: { _all: true },
    }),
    prisma.telemetryEvent.count({
      where: {
        ...scope,
        receivedAt: { gte: windowStart },
      },
    }),
    prisma.telemetryEvent.findFirst({
      where: scope,
      orderBy: { receivedAt: 'desc' },
      select: { receivedAt: true },
    }),
    prisma.alert.findFirst({
      where: scope,
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.agent.findFirst({
      where: {
        ...scope,
        lastSeenAt: { not: null },
      },
      orderBy: { lastSeenAt: 'desc' },
      select: { lastSeenAt: true },
    }),
  ]);

  const agentsByStatus = foldGroupBy(agentStatusGroups, 'status', emptyAgentStatusCounts());
  const alertsByStatus = foldGroupBy(alertStatusGroups, 'status', emptyAlertStatusCounts());
  const alertsBySeverity = foldGroupBy(alertSeverityGroups, 'severity', emptyAlertSeverityCounts());

  return {
    tenant: { id: tenant.id, name: tenant.name },
    agents: {
      total: agentsByStatus.total,
      byStatus: agentsByStatus.counts,
      recentlySeen,
    },
    alerts: {
      total: alertsByStatus.total,
      byStatus: alertsByStatus.counts,
      bySeverity: alertsBySeverity.counts,
    },
    telemetry: {
      events24h,
    },
    activity: {
      lastTelemetryReceivedAt: toIsoOrNull(latestTelemetry?.receivedAt),
      lastAlertCreatedAt: toIsoOrNull(latestAlert?.createdAt),
      lastAgentSeenAt: toIsoOrNull(latestAgentSeen?.lastSeenAt),
    },
    generatedAt: generatedAt.toISOString(),
  };
}
