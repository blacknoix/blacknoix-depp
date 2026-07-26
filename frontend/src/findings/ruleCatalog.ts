import type { CorrelationRuleId } from "./types";

/**
 * Operator-facing rule catalog mirrored from backend correlation constants.
 * Presentation only — not a second evaluation engine.
 *
 * Source of truth for thresholds/windows:
 * backend/api-gateway/src/correlation/rules.ts
 */
export interface RuleCatalogEntry {
  id: CorrelationRuleId;
  title: string;
  /** One-sentence honest description of when the rule fires. */
  summary: string;
  /** Optional signal hint for operators. */
  signals: string;
}

export const RULE_CATALOG: Readonly<
  Record<CorrelationRuleId, RuleCatalogEntry>
> = {
  "agent.lifecycle_churn": {
    id: "agent.lifecycle_churn",
    title: "Agent lifecycle churn",
    summary:
      "Fires when agent.started and agent.stopped events in a 10-minute window meet or exceed a count threshold of 6.",
    signals: "agent.started, agent.stopped",
  },
  "agent.heartbeat_burst": {
    id: "agent.heartbeat_burst",
    title: "Agent heartbeat burst",
    summary:
      "Fires when heartbeat events in a 1-minute window meet or exceed a count threshold of 30.",
    signals: "heartbeat",
  },
  "agent.heartbeat_silence": {
    id: "agent.heartbeat_silence",
    title: "Agent heartbeat silence",
    summary:
      "Fires when the agent's last heartbeat was older than 5 minutes at evaluation time. This is an absence signal evaluated on a maintenance path, not on ingest.",
    signals: "heartbeat (absence)",
  },
};

export function ruleCatalogEntry(
  ruleId: string,
): RuleCatalogEntry | null {
  if (ruleId in RULE_CATALOG) {
    return RULE_CATALOG[ruleId as CorrelationRuleId];
  }
  return null;
}

/** Compact evidence rows derived only from known correlation evidence keys. */
export interface EvidenceFact {
  label: string;
  value: string;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asIso(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function formatDurationMs(ms: number): string {
  if (ms < 60_000) {
    return `${Math.round(ms / 1000)}s`;
  }
  if (ms < 3_600_000) {
    return `${Math.round(ms / 60_000)}m`;
  }
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

/**
 * Extracts a short, honest evidence summary. Unknown / forensic fields
 * (e.g. sampleEventIds, raw dumps) are intentionally omitted.
 */
export function summarizeEvidence(
  evidence: Record<string, unknown>,
): EvidenceFact[] {
  const facts: EvidenceFact[] = [];

  const threshold = asNumber(evidence.threshold);
  const totalInWindow = asNumber(evidence.totalInWindow);
  if (threshold !== null && totalInWindow !== null) {
    facts.push({
      label: "Count vs threshold",
      value: `${totalInWindow} / ${threshold}`,
    });
  } else if (threshold !== null) {
    facts.push({ label: "Threshold", value: String(threshold) });
  } else if (totalInWindow !== null) {
    facts.push({ label: "Events in window", value: String(totalInWindow) });
  }

  const counts = evidence.countsByEventType;
  if (counts && typeof counts === "object" && !Array.isArray(counts)) {
    const parts = Object.entries(counts as Record<string, unknown>)
      .filter(([, v]) => typeof v === "number")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}: ${v as number}`);
    if (parts.length > 0) {
      facts.push({ label: "Counts by type", value: parts.join(" · ") });
    }
  }

  const silenceThresholdMs = asNumber(evidence.silenceThresholdMs);
  if (silenceThresholdMs !== null) {
    facts.push({
      label: "Silence threshold",
      value: formatDurationMs(silenceThresholdMs),
    });
  }

  const ageMs = asNumber(evidence.ageMs);
  if (ageMs !== null) {
    facts.push({ label: "Heartbeat age at eval", value: formatDurationMs(ageMs) });
  }

  const lastHeartbeatAt = asIso(evidence.lastHeartbeatAt);
  if (lastHeartbeatAt) {
    facts.push({
      label: "Last heartbeat (evidence)",
      value: new Date(lastHeartbeatAt).toLocaleString(),
    });
  }

  return facts;
}
