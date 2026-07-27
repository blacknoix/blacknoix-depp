/**
 * Heartbeat freshness for operator inventory — aligned with silence threshold
 * semantics, not a claim of online/offline connectivity.
 */
export type HeartbeatFreshness = "recent" | "stale" | "unknown";

export interface AgentInventoryRow {
  id: string;
  name: string;
  createdAt: Date;
  lastHeartbeatAt: Date | null;
  openFindingsCount: number;
  heartbeatFreshness: HeartbeatFreshness;
}

/**
 * Derive freshness from last heartbeat vs silence threshold.
 * `unknown` = never heartbeated (do not pretend the agent is offline).
 */
export function deriveHeartbeatFreshness(
  lastHeartbeatAt: Date | null,
  now: Date,
  staleAfterMs: number,
): HeartbeatFreshness {
  if (!lastHeartbeatAt) {
    return "unknown";
  }
  const ageMs = now.getTime() - lastHeartbeatAt.getTime();
  if (ageMs < 0) {
    // Clock skew: treat as recent rather than inventing an error state.
    return "recent";
  }
  return ageMs < staleAfterMs ? "recent" : "stale";
}
