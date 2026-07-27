/**
 * URL-carried Agents list + selection state.
 *
 * Query model:
 *   /agents?freshness=&hasOpenFindings=&agentId=
 *
 * - freshness / hasOpenFindings are list filters (shareable)
 * - agentId is selection within the filtered inventory
 * - Invalid values fail closed: ignored for application + caller shows a banner
 * - Changing filters should drop agentId when selection no longer matches
 *
 * Client-side only — GET /v1/agents rejects query params.
 * Deferred: agent saved views, free-text search, bulk filters.
 */

import {
  type HeartbeatFreshness,
} from "../agents/types";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const HEARTBEAT_FRESHNESS_VALUES = [
  "recent",
  "stale",
  "unknown",
] as const satisfies readonly HeartbeatFreshness[];

export interface AgentsFilters {
  freshness?: HeartbeatFreshness;
  /** When true, only agents with openFindingsCount > 0. */
  hasOpenFindings?: boolean;
}

export interface AgentsUrlState {
  filters: AgentsFilters;
  agentId: string | null;
  invalid: {
    agentId: boolean;
    freshness: boolean;
    hasOpenFindings: boolean;
  };
}

export interface AgentsUrlWrite {
  filters: AgentsFilters;
  agentId?: string | null;
}

function parseUuid(raw: string | null): {
  ok: boolean;
  present: boolean;
  id?: string;
} {
  if (raw === null || raw.trim() === "") {
    return { ok: true, present: false };
  }
  const trimmed = raw.trim().toLowerCase();
  if (!UUID.test(trimmed)) {
    return { ok: false, present: true };
  }
  return { ok: true, present: true, id: trimmed };
}

function parseFreshness(
  raw: string | null,
): { ok: true; value?: HeartbeatFreshness } | { ok: false } {
  if (raw === null || raw.trim() === "") {
    return { ok: true };
  }
  const value = raw.trim() as HeartbeatFreshness;
  if ((HEARTBEAT_FRESHNESS_VALUES as readonly string[]).includes(value)) {
    return { ok: true, value };
  }
  return { ok: false };
}

/**
 * Accepts `1` / `true` as enabled. Empty = unset. Other values fail closed.
 */
function parseHasOpenFindings(
  raw: string | null,
): { ok: true; value?: boolean } | { ok: false } {
  if (raw === null || raw.trim() === "") {
    return { ok: true };
  }
  const value = raw.trim().toLowerCase();
  if (value === "1" || value === "true") {
    return { ok: true, value: true };
  }
  if (value === "0" || value === "false") {
    return { ok: true, value: false };
  }
  return { ok: false };
}

export function parseAgentsSearchParams(
  params: URLSearchParams,
): AgentsUrlState {
  const agent = parseUuid(params.get("agentId"));
  const freshness = parseFreshness(params.get("freshness"));
  const hasOpen = parseHasOpenFindings(params.get("hasOpenFindings"));

  const filters: AgentsFilters = {};
  if (freshness.ok && freshness.value) {
    filters.freshness = freshness.value;
  }
  if (hasOpen.ok && hasOpen.value === true) {
    filters.hasOpenFindings = true;
  }

  return {
    filters,
    agentId: agent.ok && agent.present && agent.id ? agent.id : null,
    invalid: {
      agentId: !agent.ok,
      freshness: !freshness.ok,
      hasOpenFindings: !hasOpen.ok,
    },
  };
}

export function serializeAgentsSearchParams(
  write: AgentsUrlWrite,
): URLSearchParams {
  const params = new URLSearchParams();
  if (write.filters.freshness) {
    params.set("freshness", write.filters.freshness);
  }
  if (write.filters.hasOpenFindings) {
    params.set("hasOpenFindings", "1");
  }
  if (write.agentId) {
    params.set("agentId", write.agentId);
  }
  return params;
}

export function hasActiveAgentsFilters(filters: AgentsFilters): boolean {
  return Boolean(filters.freshness || filters.hasOpenFindings);
}

export function agentsFiltersEqual(
  a: AgentsFilters,
  b: AgentsFilters,
): boolean {
  return (
    a.freshness === b.freshness &&
    Boolean(a.hasOpenFindings) === Boolean(b.hasOpenFindings)
  );
}
