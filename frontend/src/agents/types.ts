export type HeartbeatFreshness = "recent" | "stale" | "unknown";

/** Explicit recent-activity window used for agent detail telemetry queries. */
export const AGENT_RECENT_ACTIVITY_HOURS = 24;
export const AGENT_RECENT_ACTIVITY_LIMIT = 20;

export interface AgentInventoryItem {
  id: string;
  name: string;
  createdAt: string;
  lastHeartbeatAt: string | null;
  openFindingsCount: number;
  heartbeatFreshness: HeartbeatFreshness;
}

/** Compact telemetry event row for agent recent activity (no payload). */
export interface AgentActivityEvent {
  id: string;
  eventType: string;
  occurredAt: string;
}

export interface AgentActivitySummary {
  agentId: string;
  lastSeenAt: string | null;
  lastHeartbeatAt: string | null;
  countsByEventType: Record<string, number>;
  totalInWindow: number;
}

export interface AgentRecentActivity {
  windowHours: number;
  since: string;
  events: AgentActivityEvent[];
  summary: AgentActivitySummary;
}

export function freshnessLabel(value: HeartbeatFreshness): string {
  switch (value) {
    case "recent":
      return "Recent heartbeat";
    case "stale":
      return "Stale heartbeat";
    case "unknown":
      return "No heartbeat yet";
  }
}
