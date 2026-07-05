import { createHash } from 'crypto';
import {
  AUTH_PRIVILEGE_CHANGE_EVENT_TYPE,
  AUTH_REMOTE_LOGON_EVENT_TYPE,
} from '../types/authTelemetry';
import {
  AuthTelemetryRow,
  CorrelatedIncident,
  LateralMovementDetectionOptions,
} from '../types/correlationIncident';

const INCIDENT_TYPE = 'lateral_movement_privilege_escalation' as const;

/**
 * Deterministic incident id for idempotent persistence.
 * Key: tenantId | authAccount | W1 bucket start (floor(firstQualifyingLogon / hostWindowMs) * hostWindowMs).
 * Mirrors outbreak bucketing; re-running over stable data yields the same id.
 */
export function deriveLateralIncidentId(
  tenantId: string,
  authAccount: string,
  firstQualifyingLogon: Date,
  hostWindowMs: number
): string {
  const windowBucketStart =
    Math.floor(firstQualifyingLogon.getTime() / hostWindowMs) * hostWindowMs;
  const material = `${tenantId}|${authAccount}|${windowBucketStart}`;
  return createHash('sha256').update(material).digest('hex');
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

function countDistinctHosts(hostCounts: Map<string, number>): number {
  let distinct = 0;
  for (const count of hostCounts.values()) {
    if (count > 0) {
      distinct += 1;
    }
  }
  return distinct;
}

function addHost(hostCounts: Map<string, number>, host: string): void {
  hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
}

function removeHost(hostCounts: Map<string, number>, host: string): void {
  const next = (hostCounts.get(host) ?? 0) - 1;
  if (next <= 0) {
    hostCounts.delete(host);
  } else {
    hostCounts.set(host, next);
  }
}

function findEscalation(
  privileges: AuthTelemetryRow[],
  tenantId: string,
  authAccount: string,
  lastLogonMs: number,
  escalationWindowMs: number
): AuthTelemetryRow | null {
  const candidates = privileges.filter(
    (row) =>
      row.tenantId === tenantId &&
      row.authAccount === authAccount &&
      row.occurredAt.getTime() >= lastLogonMs &&
      row.occurredAt.getTime() <= lastLogonMs + escalationWindowMs
  );
  if (candidates.length === 0) {
    return null;
  }
  candidates.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  return candidates[0];
}

function buildIncidentForInterval(
  logons: AuthTelemetryRow[],
  privileges: AuthTelemetryRow[],
  interval: TimeInterval,
  opts: LateralMovementDetectionOptions,
  referenceTime: Date
): CorrelatedIncident | null {
  const inWindow = logons.filter((row) => {
    const t = row.occurredAt.getTime();
    return t >= interval.startMs && t <= interval.endMs;
  });
  if (inWindow.length === 0) {
    return null;
  }

  const hosts = [...new Set(inWindow.map((row) => row.authHost!).filter(Boolean))].sort();
  if (hosts.length < opts.minHosts) {
    return null;
  }

  const firstSeen = new Date(Math.min(...inWindow.map((row) => row.occurredAt.getTime())));
  const lastLogonMs = Math.max(...inWindow.map((row) => row.occurredAt.getTime()));

  if (lastLogonMs - firstSeen.getTime() > opts.hostWindowMs) {
    return null;
  }

  const tenantId = inWindow[0].tenantId;
  const authAccount = inWindow[0].authAccount;
  const escalation = findEscalation(
    privileges,
    tenantId,
    authAccount,
    lastLogonMs,
    opts.escalationWindowMs
  );
  if (!escalation) {
    return null;
  }

  const logonIds = [...inWindow.map((row) => row.id)].sort();
  const alertIds = [...logonIds, escalation.id].sort();
  const escalatedAt = escalation.occurredAt;
  const id = deriveLateralIncidentId(tenantId, authAccount, firstSeen, opts.hostWindowMs);

  return {
    id,
    tenantId,
    type: INCIDENT_TYPE,
    indicator: authAccount,
    agentIds: hosts,
    alertIds,
    firstSeen,
    lastSeen: escalatedAt,
    escalatedAt,
    agentCount: hosts.length,
    createdAt: referenceTime,
  };
}

function detectForLogonGroup(
  logons: AuthTelemetryRow[],
  privileges: AuthTelemetryRow[],
  opts: LateralMovementDetectionOptions,
  referenceTime: Date
): CorrelatedIncident[] {
  const sorted = [...logons].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const qualifyingIntervals: TimeInterval[] = [];
  const hostCounts = new Map<string, number>();
  let left = 0;

  for (let right = 0; right < sorted.length; right += 1) {
    const host = sorted[right].authHost;
    if (!host) {
      continue;
    }
    addHost(hostCounts, host);

    while (
      left < right &&
      sorted[right].occurredAt.getTime() - sorted[left].occurredAt.getTime() > opts.hostWindowMs
    ) {
      const evictedHost = sorted[left].authHost;
      if (evictedHost) {
        removeHost(hostCounts, evictedHost);
      }
      left += 1;
    }

    if (countDistinctHosts(hostCounts) >= opts.minHosts) {
      qualifyingIntervals.push({
        startMs: sorted[left].occurredAt.getTime(),
        endMs: sorted[right].occurredAt.getTime(),
      });
    }
  }

  const merged = mergeIntervals(qualifyingIntervals);
  const incidents: CorrelatedIncident[] = [];

  for (const interval of merged) {
    const incident = buildIncidentForInterval(sorted, privileges, interval, opts, referenceTime);
    if (incident) {
      incidents.push(incident);
    }
  }

  return incidents;
}

/**
 * Pure lateral-movement + privilege-escalation detection — no DB, deterministic output.
 * Stage 1: same authAccount reaches minHosts distinct authHost via remote_logon within hostWindowMs.
 * Stage 2: privilege_change for that account within escalationWindowMs after the last qualifying logon.
 * Both stages required; hosts-only activity without escalation emits nothing.
 */
export function detectLateralMovement(
  authEvents: AuthTelemetryRow[],
  opts: LateralMovementDetectionOptions,
  referenceTime: Date = new Date()
): CorrelatedIncident[] {
  const logons = authEvents.filter(
    (row) =>
      row.eventType === AUTH_REMOTE_LOGON_EVENT_TYPE &&
      row.authAccount.trim().length > 0 &&
      row.authHost !== null &&
      row.authHost.trim().length > 0
  );

  const privileges = authEvents.filter(
    (row) =>
      row.eventType === AUTH_PRIVILEGE_CHANGE_EVENT_TYPE &&
      row.authAccount.trim().length > 0
  );

  const groups = new Map<string, AuthTelemetryRow[]>();
  for (const row of logons) {
    const key = `${row.tenantId}\0${row.authAccount}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  const incidents: CorrelatedIncident[] = [];
  for (const groupLogons of groups.values()) {
    incidents.push(...detectForLogonGroup(groupLogons, privileges, opts, referenceTime));
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
