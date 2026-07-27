import type { TelemetryWindowSummary } from "../telemetry/repository";

/**
 * Deterministic correlation rules.
 *
 * Count-based rules (v1) run post-ingest. Silence runs only via the operator
 * maintenance evaluate path — dead agents never ingest.
 *
 * Signals: heartbeat, agent.started, agent.stopped only. No DSL, no ML.
 */

export type FindingSeverity = "low" | "medium" | "high";

export const RULE_LIFECYCLE_CHURN_ID = "agent.lifecycle_churn" as const;
export const RULE_HEARTBEAT_BURST_ID = "agent.heartbeat_burst" as const;
export const RULE_HEARTBEAT_SILENCE_ID = "agent.heartbeat_silence" as const;

/** All rule ids accepted by GET /v1/findings?ruleId=… */
export const CORRELATION_RULE_IDS = [
  RULE_LIFECYCLE_CHURN_ID,
  RULE_HEARTBEAT_BURST_ID,
  RULE_HEARTBEAT_SILENCE_ID,
] as const;

export type CorrelationRuleId = (typeof CORRELATION_RULE_IDS)[number];

export interface CorrelationRuleDef {
  id: CorrelationRuleId;
  title: string;
  severity: FindingSeverity;
  windowMs: number;
  threshold: number;
  eventTypes: readonly string[];
}

export const LIFECYCLE_CHURN_RULE: CorrelationRuleDef = {
  id: RULE_LIFECYCLE_CHURN_ID,
  title: "Agent lifecycle churn",
  severity: "medium",
  windowMs: 10 * 60 * 1000,
  threshold: 6,
  eventTypes: ["agent.started", "agent.stopped"],
};

export const HEARTBEAT_BURST_RULE: CorrelationRuleDef = {
  id: RULE_HEARTBEAT_BURST_ID,
  title: "Agent heartbeat burst",
  severity: "medium",
  windowMs: 60 * 1000,
  threshold: 30,
  eventTypes: ["heartbeat"],
};

/**
 * Post-ingest count rules only. Silence is intentionally excluded — it is an
 * absence signal evaluated on the maintenance path.
 */
export const CORRELATION_RULES: readonly CorrelationRuleDef[] = [
  LIFECYCLE_CHURN_RULE,
  HEARTBEAT_BURST_RULE,
];

/** No heartbeat for this long → silence finding (constant, no env knobs). */
export const SILENCE_THRESHOLD_MS = 5 * 60 * 1000;

export const HEARTBEAT_SILENCE_RULE = {
  id: RULE_HEARTBEAT_SILENCE_ID,
  title: "Agent heartbeat silence",
  severity: "medium" as const,
  thresholdMs: SILENCE_THRESHOLD_MS,
};

export interface FindingCandidate {
  ruleId: CorrelationRuleId;
  title: string;
  severity: FindingSeverity;
  windowStart: Date;
  windowEnd: Date;
  windowBucket: Date;
  evidence: Record<string, unknown>;
}

/**
 * Floors `at` to the start of a fixed-size bucket aligned to the Unix epoch.
 * Used as the dedup key so re-evaluation in the same bucket is a no-op insert.
 */
export function floorToWindowBucket(at: Date, windowMs: number): Date {
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error("windowMs must be a positive finite number");
  }
  const ms = at.getTime();
  return new Date(Math.floor(ms / windowMs) * windowMs);
}

function buildEvidence(
  rule: CorrelationRuleDef,
  summary: TelemetryWindowSummary,
  windowStart: Date,
  windowEnd: Date,
): Record<string, unknown> {
  return {
    ruleId: rule.id,
    threshold: rule.threshold,
    windowMs: rule.windowMs,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    countsByEventType: summary.countsByType,
    totalInWindow: summary.total,
    oldestOccurredAt: summary.oldestOccurredAt
      ? summary.oldestOccurredAt.toISOString()
      : null,
    newestOccurredAt: summary.newestOccurredAt
      ? summary.newestOccurredAt.toISOString()
      : null,
    sampleEventIds: summary.sampleEventIds,
  };
}

/**
 * Pure evaluator: fires when total matching events in the window meet threshold.
 */
export function evaluateCountRule(
  rule: CorrelationRuleDef,
  summary: TelemetryWindowSummary,
  windowEnd: Date,
): FindingCandidate | null {
  if (summary.total < rule.threshold) {
    return null;
  }

  const windowStart = new Date(windowEnd.getTime() - rule.windowMs);
  const windowBucket = floorToWindowBucket(windowStart, rule.windowMs);

  return {
    ruleId: rule.id,
    title: rule.title,
    severity: rule.severity,
    windowStart,
    windowEnd,
    windowBucket,
    evidence: buildEvidence(rule, summary, windowStart, windowEnd),
  };
}

export interface HeartbeatSilenceInput {
  /** null = never heartbeated → do not fire (avoid enrollment noise). */
  lastHeartbeatAt: Date | null;
  now: Date;
}

/**
 * Pure silence evaluator: fires when a prior heartbeat is older than threshold.
 */
export function evaluateHeartbeatSilence(
  input: HeartbeatSilenceInput,
): FindingCandidate | null {
  const { lastHeartbeatAt, now } = input;
  if (!lastHeartbeatAt) {
    return null;
  }

  const ageMs = now.getTime() - lastHeartbeatAt.getTime();
  if (ageMs < SILENCE_THRESHOLD_MS) {
    return null;
  }

  const windowEnd = now;
  const windowStart = new Date(windowEnd.getTime() - SILENCE_THRESHOLD_MS);
  const windowBucket = floorToWindowBucket(windowStart, SILENCE_THRESHOLD_MS);

  return {
    ruleId: RULE_HEARTBEAT_SILENCE_ID,
    title: HEARTBEAT_SILENCE_RULE.title,
    severity: HEARTBEAT_SILENCE_RULE.severity,
    windowStart,
    windowEnd,
    windowBucket,
    evidence: {
      ruleId: RULE_HEARTBEAT_SILENCE_ID,
      silenceThresholdMs: SILENCE_THRESHOLD_MS,
      lastHeartbeatAt: lastHeartbeatAt.toISOString(),
      evaluatedAt: now.toISOString(),
      ageMs,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    },
  };
}

export function isCorrelationRuleId(value: string): value is CorrelationRuleId {
  return (CORRELATION_RULE_IDS as readonly string[]).includes(value);
}
