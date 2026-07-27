/**
 * Narrow operator entity lookup for the Jump bar.
 *
 * Searchable (deterministic):
 * - Agent id: exact UUID, or id prefix (≥8 hex chars) against inventory
 * - Agent name: case-insensitive prefix (query length ≥ 2)
 * - Finding id: full UUID only, when it is not an exact inventory agent id
 *
 * Not searchable: finding titles, free text, telemetry, fuzzy match.
 * No backend search index — inventory is loaded via existing GET /v1/agents.
 *
 * Deferred: full-text search, fuzzy search, cross-entity timelines.
 */

import type { AgentInventoryItem } from "../agents/types";
import { agentsPath, findingsPath } from "../routing/crossLinks";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Prefix lookup needs enough hex to stay useful and avoid noise. */
export const LOOKUP_ID_PREFIX_MIN = 8;
export const LOOKUP_NAME_PREFIX_MIN = 2;
export const LOOKUP_AGENT_NAME_MAX = 8;

export type LookupEntity = "agent" | "finding";

export interface LookupResult {
  id: string;
  entity: LookupEntity;
  label: string;
  to: string;
  /** Lower is better. */
  rank: number;
}

function normalizeQuery(raw: string): string {
  return raw.trim().toLowerCase();
}

function isUuid(value: string): boolean {
  return UUID.test(value);
}

function hexPrefixCandidate(value: string): boolean {
  if (value.length < LOOKUP_ID_PREFIX_MIN) {
    return false;
  }
  return /^[0-9a-f-]+$/i.test(value);
}

/**
 * Build ranked lookup hits for the current query against loaded inventory.
 * Empty / too-short queries yield no entity hits (static jump commands remain).
 */
export function buildEntityLookupResults(
  query: string,
  agents: readonly AgentInventoryItem[],
): LookupResult[] {
  const q = normalizeQuery(query);
  if (q.length === 0) {
    return [];
  }

  const results: LookupResult[] = [];
  const seen = new Set<string>();

  function push(result: LookupResult) {
    if (seen.has(result.id)) {
      return;
    }
    seen.add(result.id);
    results.push(result);
  }

  const exactAgent = agents.find((agent) => agent.id === q);
  if (exactAgent) {
    push({
      id: `lookup.agent.${exactAgent.id}`,
      entity: "agent",
      label: `Agent · ${exactAgent.name}`,
      to: agentsPath(exactAgent.id),
      rank: 0,
    });
  }

  for (const agent of agents) {
    if (agent.name.trim().toLowerCase() === q) {
      push({
        id: `lookup.agent.${agent.id}`,
        entity: "agent",
        label: `Agent · ${agent.name}`,
        to: agentsPath(agent.id),
        rank: 1,
      });
    }
  }

  if (!exactAgent && hexPrefixCandidate(q)) {
    for (const agent of agents) {
      if (agent.id.startsWith(q)) {
        push({
          id: `lookup.agent.${agent.id}`,
          entity: "agent",
          label: `Agent · ${agent.name}`,
          to: agentsPath(agent.id),
          rank: 2,
        });
      }
    }
  }

  if (q.length >= LOOKUP_NAME_PREFIX_MIN) {
    const nameHits: LookupResult[] = [];
    for (const agent of agents) {
      const name = agent.name.trim().toLowerCase();
      if (name.startsWith(q) && name !== q) {
        nameHits.push({
          id: `lookup.agent.${agent.id}`,
          entity: "agent",
          label: `Agent · ${agent.name}`,
          to: agentsPath(agent.id),
          rank: 3,
        });
      }
    }
    nameHits
      .sort((a, b) => a.label.localeCompare(b.label))
      .slice(0, LOOKUP_AGENT_NAME_MAX)
      .forEach(push);
  }

  if (isUuid(q) && !exactAgent) {
    push({
      id: `lookup.finding.${q}`,
      entity: "finding",
      label: `Finding · ${q}`,
      to: findingsPath({ findingId: q }),
      rank: 4,
    });
  }

  return results.sort((a, b) => {
    if (a.rank !== b.rank) {
      return a.rank - b.rank;
    }
    return a.label.localeCompare(b.label);
  });
}
