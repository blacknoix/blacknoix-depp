/**
 * ADR-0005 bridge-removal: tenant signed-coverage eligibility.
 *
 * Coverage is derived from persisted correlation_findings detection_source
 * counts (agent_signed vs bridge_correlation). No analytics subsystem.
 *
 * Disablement of the bridge is fail-closed: eligibility errors / insufficient
 * data keep the bridge enabled. Historical rows are never rewritten.
 */

import {
  DETECTION_SOURCE_AGENT_SIGNED,
  DETECTION_SOURCE_BRIDGE,
} from "./provenance";

export interface BridgeCoverageCounts {
  signedCount: number;
  bridgeCount: number;
  /** Earliest agent_signed finding created_at for the tenant (any time). */
  firstSignedAt: Date | null;
  /** Earliest finding (signed or bridge) created_at inside the lookback window. */
  oldestInWindowAt: Date | null;
}

export interface BridgeCoveragePolicy {
  /** Minimum signed/(signed+bridge) ratio in the soak lookback. */
  threshold: number;
  /** Required age of first signed finding before auto-disable may fire. */
  soakMs: number;
  /** Minimum signed+bridge findings in the lookback window. */
  minFindings: number;
}

export type BridgeCoverageIneligibilityReason =
  | "insufficient_findings"
  | "below_threshold"
  | "soak_not_met"
  | "no_signed_history"
  | "empty_window";

export interface BridgeCoverageEvaluation {
  tenantId: string;
  windowStart: Date;
  windowEnd: Date;
  signedCount: number;
  bridgeCount: number;
  total: number;
  signedRatio: number;
  firstSignedAt: Date | null;
  oldestInWindowAt: Date | null;
  soakMs: number;
  threshold: number;
  minFindings: number;
  eligible: boolean;
  reasons: BridgeCoverageIneligibilityReason[];
}

export function signedCoverageRatio(
  signedCount: number,
  bridgeCount: number,
): number {
  const total = signedCount + bridgeCount;
  if (total <= 0) {
    return 0;
  }
  return signedCount / total;
}

/**
 * Pure eligibility decision from persisted coverage counts.
 * Soak: first agent_signed finding must be at least soakMs old.
 * Threshold: signed ratio in [now - soakMs, now] must meet threshold with
 * enough samples.
 */
export function evaluateBridgeCoverageEligibility(
  tenantId: string,
  counts: BridgeCoverageCounts,
  policy: BridgeCoveragePolicy,
  at: Date,
): BridgeCoverageEvaluation {
  const windowEnd = at;
  const windowStart = new Date(at.getTime() - policy.soakMs);
  const total = counts.signedCount + counts.bridgeCount;
  const signedRatio = signedCoverageRatio(
    counts.signedCount,
    counts.bridgeCount,
  );
  const reasons: BridgeCoverageIneligibilityReason[] = [];

  if (total === 0) {
    reasons.push("empty_window");
  }
  if (total < policy.minFindings) {
    reasons.push("insufficient_findings");
  }
  if (signedRatio < policy.threshold) {
    reasons.push("below_threshold");
  }
  if (!counts.firstSignedAt) {
    reasons.push("no_signed_history");
  } else if (at.getTime() - counts.firstSignedAt.getTime() < policy.soakMs) {
    reasons.push("soak_not_met");
  }

  return {
    tenantId,
    windowStart,
    windowEnd,
    signedCount: counts.signedCount,
    bridgeCount: counts.bridgeCount,
    total,
    signedRatio,
    firstSignedAt: counts.firstSignedAt,
    oldestInWindowAt: counts.oldestInWindowAt,
    soakMs: policy.soakMs,
    threshold: policy.threshold,
    minFindings: policy.minFindings,
    eligible: reasons.length === 0,
    reasons,
  };
}

export function coverageAuditFields(
  evaluation: BridgeCoverageEvaluation,
): Record<string, unknown> {
  return {
    tenantId: evaluation.tenantId,
    signedCount: evaluation.signedCount,
    bridgeCount: evaluation.bridgeCount,
    total: evaluation.total,
    signedRatio: evaluation.signedRatio,
    threshold: evaluation.threshold,
    soakMs: evaluation.soakMs,
    minFindings: evaluation.minFindings,
    eligible: evaluation.eligible,
    reasons: evaluation.reasons,
    firstSignedAt: evaluation.firstSignedAt?.toISOString() ?? null,
    windowStart: evaluation.windowStart.toISOString(),
    windowEnd: evaluation.windowEnd.toISOString(),
    signed_source: DETECTION_SOURCE_AGENT_SIGNED,
    bridge_source: DETECTION_SOURCE_BRIDGE,
  };
}
