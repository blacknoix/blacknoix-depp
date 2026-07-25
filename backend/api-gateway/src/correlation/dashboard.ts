import {
  FINDING_STATUSES,
  type FindingStatus,
} from "./lifecycle";
import {
  CORRELATION_RULE_IDS,
  type CorrelationRuleId,
} from "./rules";

/**
 * Operator findings dashboard read-model — fixed windows, zero-filled
 * aggregates. Not a BI / reporting surface.
 *
 * Deferred: flexible windows, charts, export, scheduled digests.
 */

/** Fixed lookback for recentCreated / recentChanged. Not query-overridable. */
export const DASHBOARD_RECENT_HOURS = 24;

export interface FindingsDashboard {
  generatedAt: Date;
  windowHours: number;
  countsByStatus: Record<FindingStatus, number>;
  countsByRuleId: Record<CorrelationRuleId, number>;
  recentCreatedCount: number;
  recentChangedCount: number;
  activeSuppressionCount: number;
}

export interface FindingsDashboardRawCounts {
  statusCounts: ReadonlyArray<{ status: string; count: number }>;
  ruleCounts: ReadonlyArray<{ ruleId: string; count: number }>;
  recentCreatedCount: number;
  recentChangedCount: number;
  activeSuppressionCount: number;
}

export function emptyStatusCounts(): Record<FindingStatus, number> {
  return {
    open: 0,
    acknowledged: 0,
    resolved: 0,
  };
}

export function emptyRuleCounts(): Record<CorrelationRuleId, number> {
  const out = {} as Record<CorrelationRuleId, number>;
  for (const id of CORRELATION_RULE_IDS) {
    out[id] = 0;
  }
  return out;
}

/**
 * Assembles a deterministic dashboard from raw SQL aggregates.
 * Unknown statuses/rule ids in raw data are ignored (fail soft on orphans);
 * known keys are always present with zeros.
 */
export function assembleFindingsDashboard(
  generatedAt: Date,
  raw: FindingsDashboardRawCounts,
): FindingsDashboard {
  const countsByStatus = emptyStatusCounts();
  for (const row of raw.statusCounts) {
    if ((FINDING_STATUSES as readonly string[]).includes(row.status)) {
      countsByStatus[row.status as FindingStatus] = row.count;
    }
  }

  const countsByRuleId = emptyRuleCounts();
  for (const row of raw.ruleCounts) {
    if ((CORRELATION_RULE_IDS as readonly string[]).includes(row.ruleId)) {
      countsByRuleId[row.ruleId as CorrelationRuleId] = row.count;
    }
  }

  return {
    generatedAt,
    windowHours: DASHBOARD_RECENT_HOURS,
    countsByStatus,
    countsByRuleId,
    recentCreatedCount: raw.recentCreatedCount,
    recentChangedCount: raw.recentChangedCount,
    activeSuppressionCount: raw.activeSuppressionCount,
  };
}
