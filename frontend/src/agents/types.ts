export type HeartbeatFreshness = "recent" | "stale" | "unknown";

export interface AgentInventoryItem {
  id: string;
  name: string;
  createdAt: string;
  lastHeartbeatAt: string | null;
  openFindingsCount: number;
  heartbeatFreshness: HeartbeatFreshness;
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
