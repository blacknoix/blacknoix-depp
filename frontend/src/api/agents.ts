import { apiRequest } from "../api/client";
import type { OperatorSession } from "../auth/session";
import type { Finding } from "../findings/types";
import {
  AGENT_RECENT_ACTIVITY_HOURS,
  AGENT_RECENT_ACTIVITY_LIMIT,
  type AgentInventoryItem,
  type AgentRecentActivity,
} from "../agents/types";

export async function fetchAgentInventory(
  session: OperatorSession,
): Promise<AgentInventoryItem[]> {
  const data = await apiRequest<{ agents: AgentInventoryItem[] }>(
    session,
    "/v1/agents",
  );
  return data.agents;
}

export async function fetchAgentFindings(
  session: OperatorSession,
  agentId: string,
): Promise<Finding[]> {
  const params = new URLSearchParams({
    agentId,
    limit: "10",
    offset: "0",
  });
  const data = await apiRequest<{ findings: Finding[] }>(
    session,
    `/v1/findings?${params.toString()}`,
  );
  return data.findings;
}

/**
 * Recent telemetry for one agent over an explicit wall-clock window.
 * Always sends `since` so summary counts are not unbounded.
 */
export async function fetchAgentRecentActivity(
  session: OperatorSession,
  agentId: string,
  now: Date = new Date(),
): Promise<AgentRecentActivity> {
  const since = new Date(
    now.getTime() - AGENT_RECENT_ACTIVITY_HOURS * 60 * 60 * 1000,
  );
  const params = new URLSearchParams({
    agentId,
    since: since.toISOString(),
    limit: String(AGENT_RECENT_ACTIVITY_LIMIT),
    offset: "0",
  });
  const data = await apiRequest<{
    events: Array<{
      id: string;
      eventType: string;
      occurredAt: string;
    }>;
    summary: {
      agentId: string;
      lastSeenAt: string | null;
      lastHeartbeatAt: string | null;
      countsByEventType: Record<string, number>;
      totalInWindow: number;
    };
  }>(session, `/v1/telemetry/events?${params.toString()}`);

  return {
    windowHours: AGENT_RECENT_ACTIVITY_HOURS,
    since: since.toISOString(),
    events: data.events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
    })),
    summary: {
      agentId: data.summary.agentId,
      lastSeenAt: data.summary.lastSeenAt,
      lastHeartbeatAt: data.summary.lastHeartbeatAt,
      countsByEventType: data.summary.countsByEventType,
      totalInWindow: data.summary.totalInWindow,
    },
  };
}
