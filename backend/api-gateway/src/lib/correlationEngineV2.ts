import { createHash } from 'crypto';
import {
  CorrelatedIncident,
  CorrelatedIncidentType,
  OutbreakAlertRow,
  OutbreakDetectionOptions,
} from '../types/correlationIncident';

const INCIDENT_TYPE: CorrelatedIncidentType = 'malware_outbreak';

/**
 * Deterministic incident id for idempotent persistence.
 * Key: tenantId | indicator | window bucket start (floor(firstSeen / windowMs) * windowMs).
 * Re-running detection over overlapping alert data yields the same id for the same outbreak.
 */
export function deriveOutbreakIncidentId(
  tenantId: string,
  indicator: string,
  firstSeen: Date,
  windowMs: number
): string {
  const windowBucketStart = Math.floor(firstSeen.getTime() / windowMs) * windowMs;
  const material = `${tenantId}|${indicator}|${windowBucketStart}`;
  return createHash('sha256').update(material).digest('hex');
}

function groupKey(row: OutbreakAlertRow): string {
  return `${row.tenantId}\0${row.indicator}`;
}

function countDistinctAgents(agentCounts: Map<string, number>): number {
  let distinct = 0;
  for (const count of agentCounts.values()) {
    if (count > 0) {
      distinct += 1;
    }
  }
  return distinct;
}

function addAgent(agentCounts: Map<string, number>, agentId: string): void {
  agentCounts.set(agentId, (agentCounts.get(agentId) ?? 0) + 1);
}

function removeAgent(agentCounts: Map<string, number>, agentId: string): void {
  const next = (agentCounts.get(agentId) ?? 0) - 1;
  if (next <= 0) {
    agentCounts.delete(agentId);
  } else {
    agentCounts.set(agentId, next);
  }
}

interface TimeInterval {
  startMs: number;
  endMs: number;
}

function mergeIntervals(intervals: TimeInterval[]): TimeInterval[] {
  if (intervals.length === 0) {
    return [];
  }
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  const merged: TimeInterval[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    const last = merged[merged.length - 1];
    const current = sorted[i];
    if (current.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, current.endMs);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

function buildIncidentForCluster(
  rows: OutbreakAlertRow[],
  interval: TimeInterval,
  windowMs: number,
  minAgents: number,
  referenceTime: Date
): CorrelatedIncident | null {
  const inCluster = rows.filter((row) => {
    const t = row.createdAt.getTime();
    return t >= interval.startMs && t <= interval.endMs;
  });
  if (inCluster.length === 0) {
    return null;
  }

  const agentIds = [...new Set(inCluster.map((row) => row.agentId))].sort();
  if (agentIds.length < minAgents) {
    return null;
  }

  const alertIds = [...inCluster.map((row) => row.id)].sort();
  const firstSeen = new Date(Math.min(...inCluster.map((row) => row.createdAt.getTime())));
  const lastSeen = new Date(Math.max(...inCluster.map((row) => row.createdAt.getTime())));

  if (lastSeen.getTime() - firstSeen.getTime() > windowMs) {
    return null;
  }

  const tenantId = inCluster[0].tenantId;
  const indicator = inCluster[0].indicator!;
  const id = deriveOutbreakIncidentId(tenantId, indicator, firstSeen, windowMs);

  return {
    id,
    tenantId,
    type: INCIDENT_TYPE,
    indicator,
    agentIds,
    alertIds,
    firstSeen,
    lastSeen,
    agentCount: agentIds.length,
    createdAt: referenceTime,
  };
}

function detectOutbreaksForGroup(
  rows: OutbreakAlertRow[],
  opts: OutbreakDetectionOptions,
  referenceTime: Date
): CorrelatedIncident[] {
  const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const qualifyingIntervals: TimeInterval[] = [];
  const agentCounts = new Map<string, number>();
  let left = 0;

  for (let right = 0; right < sorted.length; right += 1) {
    addAgent(agentCounts, sorted[right].agentId);

    while (
      left < right &&
      sorted[right].createdAt.getTime() - sorted[left].createdAt.getTime() > opts.windowMs
    ) {
      removeAgent(agentCounts, sorted[left].agentId);
      left += 1;
    }

    if (countDistinctAgents(agentCounts) >= opts.minAgents) {
      qualifyingIntervals.push({
        startMs: sorted[left].createdAt.getTime(),
        endMs: sorted[right].createdAt.getTime(),
      });
    }
  }

  const merged = mergeIntervals(qualifyingIntervals);
  const incidents: CorrelatedIncident[] = [];

  for (const interval of merged) {
    const incident = buildIncidentForCluster(sorted, interval, opts.windowMs, opts.minAgents, referenceTime);
    if (incident) {
      incidents.push(incident);
    }
  }

  return incidents;
}

/**
 * Pure malware-indicator outbreak detection — no DB, deterministic output.
 * Ignores alerts with null indicator. Groups by (tenantId, indicator).
 */
export function detectOutbreaks(
  alerts: OutbreakAlertRow[],
  opts: OutbreakDetectionOptions,
  referenceTime: Date = new Date()
): CorrelatedIncident[] {
  const withIndicator = alerts.filter(
    (row): row is OutbreakAlertRow & { indicator: string } =>
      row.indicator !== null && row.indicator.trim().length > 0
  );

  const groups = new Map<string, OutbreakAlertRow[]>();
  for (const row of withIndicator) {
    const key = groupKey(row);
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  const incidents: CorrelatedIncident[] = [];
  for (const groupRows of groups.values()) {
    incidents.push(...detectOutbreaksForGroup(groupRows, opts, referenceTime));
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
