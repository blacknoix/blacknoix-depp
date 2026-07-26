export type FindingStatus = "open" | "acknowledged" | "resolved";

export const FINDING_STATUSES: readonly FindingStatus[] = [
  "open",
  "acknowledged",
  "resolved",
] as const;

export type CorrelationRuleId =
  | "agent.lifecycle_churn"
  | "agent.heartbeat_burst"
  | "agent.heartbeat_silence";

export const CORRELATION_RULE_IDS: readonly CorrelationRuleId[] = [
  "agent.lifecycle_churn",
  "agent.heartbeat_burst",
  "agent.heartbeat_silence",
] as const;

export interface Finding {
  id: string;
  agentId: string;
  ruleId: string;
  title: string;
  severity: string;
  status: FindingStatus;
  statusChangedAt: string | null;
  statusChangedByUserId: string | null;
  ownerUserId: string | null;
  ownerChangedAt: string | null;
  ownerChangedByUserId: string | null;
  operatorNote: string | null;
  operatorNoteUpdatedAt: string | null;
  operatorNoteUpdatedByUserId: string | null;
  evidence: Record<string, unknown>;
  windowStart: string;
  windowEnd: string;
  createdAt: string;
}

export interface FindingsDashboard {
  generatedAt: string;
  window: { hours: number };
  countsByStatus: Record<FindingStatus, number>;
  countsByRuleId: Record<CorrelationRuleId, number>;
  recentCreatedCount: number;
  recentChangedCount: number;
  activeSuppressionCount: number;
}

export interface Suppression {
  id: string;
  ruleId: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  createdByUserId: string | null;
  clearedAt: string | null;
  clearedByUserId: string | null;
}

export type FindingsOwnerScope = "me" | "none";

export const FINDINGS_OWNER_SCOPES: readonly FindingsOwnerScope[] = [
  "me",
  "none",
] as const;

export interface FindingsFilters {
  agentId?: string;
  status?: FindingStatus;
  ruleId?: CorrelationRuleId;
  /** Operator work-queue owner scope (URL-backed). */
  ownerScope?: FindingsOwnerScope;
}

/** Allowed next statuses from the backend lifecycle (same-status = noop). */
export const STATUS_TRANSITIONS: Readonly<
  Record<FindingStatus, readonly FindingStatus[]>
> = {
  open: ["acknowledged", "resolved"],
  acknowledged: ["resolved", "open"],
  resolved: ["open"],
};

export function allowedTransitions(from: FindingStatus): FindingStatus[] {
  return [...STATUS_TRANSITIONS[from]];
}
