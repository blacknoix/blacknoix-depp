/**
 * Client-side Agents inventory filtering and investigation ordering.
 *
 * Uses inventory fields already returned by GET /v1/agents.
 * Not a search platform or device-management query API.
 */

import type { AgentsFilters } from "../routing/agentsUrlState";
import type { AgentInventoryItem, HeartbeatFreshness } from "./types";
import type { Finding, FindingStatus } from "../findings/types";

const FRESHNESS_RANK: Record<HeartbeatFreshness, number> = {
  stale: 0,
  unknown: 1,
  recent: 2,
};

const STATUS_RANK: Record<FindingStatus, number> = {
  open: 0,
  acknowledged: 1,
  resolved: 2,
};

export function agentMatchesFilters(
  agent: AgentInventoryItem,
  filters: AgentsFilters,
): boolean {
  if (filters.freshness && agent.heartbeatFreshness !== filters.freshness) {
    return false;
  }
  if (filters.hasOpenFindings && agent.openFindingsCount <= 0) {
    return false;
  }
  return true;
}

export function filterAgents(
  agents: readonly AgentInventoryItem[],
  filters: AgentsFilters,
): AgentInventoryItem[] {
  return agents.filter((agent) => agentMatchesFilters(agent, filters));
}

/**
 * Investigation-oriented order: stale → unknown → recent, then open findings
 * descending, then name.
 */
export function sortAgentsForInvestigation(
  agents: readonly AgentInventoryItem[],
): AgentInventoryItem[] {
  return [...agents].sort((a, b) => {
    const freshness =
      FRESHNESS_RANK[a.heartbeatFreshness] -
      FRESHNESS_RANK[b.heartbeatFreshness];
    if (freshness !== 0) {
      return freshness;
    }
    if (b.openFindingsCount !== a.openFindingsCount) {
      return b.openFindingsCount - a.openFindingsCount;
    }
    return a.name.localeCompare(b.name);
  });
}

/** Open findings first for agent-centric triage handoff. */
export function sortRelatedFindings(
  findings: readonly Finding[],
): Finding[] {
  return [...findings].sort((a, b) => {
    const status = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (status !== 0) {
      return status;
    }
    return b.createdAt.localeCompare(a.createdAt);
  });
}
