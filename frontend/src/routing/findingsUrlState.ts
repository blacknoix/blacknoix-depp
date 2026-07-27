/**
 * URL-carried Findings filter + selection state.
 *
 * Query model:
 *   /findings?status=&ruleId=&agentId=&findingId=
 *
 * - status / ruleId / agentId are list filters (shareable)
 * - findingId is selection within the current filtered list (not a filter)
 * - Invalid values fail closed: ignored for application + caller shows a banner
 * - Changing filters should drop findingId (caller responsibility)
 *
 * Deferred: free-text search, time-window filters (API has none).
 * Saved views (local) compose on top of this URL model — see savedViews.ts.
 */

import {
  CORRELATION_RULE_IDS,
  FINDING_STATUSES,
  type CorrelationRuleId,
  type FindingStatus,
  type FindingsFilters,
} from "../findings/types";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FindingsUrlState {
  filters: FindingsFilters;
  /** Valid finding selection id when present. */
  findingId: string | null;
  invalid: {
    agentId: boolean;
    findingId: boolean;
    status: boolean;
    ruleId: boolean;
  };
}

export interface FindingsUrlWrite {
  filters: FindingsFilters;
  findingId?: string | null;
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

function parseStatusParam(
  raw: string | null,
): { ok: true; value?: FindingStatus } | { ok: false } {
  if (raw === null || raw.trim() === "") {
    return { ok: true };
  }
  const value = raw.trim() as FindingStatus;
  if ((FINDING_STATUSES as readonly string[]).includes(value)) {
    return { ok: true, value };
  }
  return { ok: false };
}

function parseRuleIdParam(
  raw: string | null,
): { ok: true; value?: CorrelationRuleId } | { ok: false } {
  if (raw === null || raw.trim() === "") {
    return { ok: true };
  }
  const value = raw.trim() as CorrelationRuleId;
  if ((CORRELATION_RULE_IDS as readonly string[]).includes(value)) {
    return { ok: true, value };
  }
  return { ok: false };
}

export function parseFindingsSearchParams(
  params: URLSearchParams,
): FindingsUrlState {
  const agent = parseUuid(params.get("agentId"));
  const finding = parseUuid(params.get("findingId"));
  const status = parseStatusParam(params.get("status"));
  const ruleId = parseRuleIdParam(params.get("ruleId"));

  const filters: FindingsFilters = {};
  if (agent.ok && agent.present && agent.id) {
    filters.agentId = agent.id;
  }
  if (status.ok && status.value) {
    filters.status = status.value;
  }
  if (ruleId.ok && ruleId.value) {
    filters.ruleId = ruleId.value;
  }

  return {
    filters,
    findingId: finding.ok && finding.present && finding.id ? finding.id : null,
    invalid: {
      agentId: !agent.ok,
      findingId: !finding.ok,
      status: !status.ok,
      ruleId: !ruleId.ok,
    },
  };
}

export function serializeFindingsSearchParams(
  write: FindingsUrlWrite,
): URLSearchParams {
  const params = new URLSearchParams();
  if (write.filters.status) {
    params.set("status", write.filters.status);
  }
  if (write.filters.ruleId) {
    params.set("ruleId", write.filters.ruleId);
  }
  if (write.filters.agentId) {
    params.set("agentId", write.filters.agentId);
  }
  if (write.findingId) {
    params.set("findingId", write.findingId);
  }
  return params;
}

export function filtersEqual(
  a: FindingsFilters,
  b: FindingsFilters,
): boolean {
  return (
    a.agentId === b.agentId &&
    a.status === b.status &&
    a.ruleId === b.ruleId
  );
}

export function hasActiveFilters(filters: FindingsFilters): boolean {
  return Boolean(filters.agentId || filters.status || filters.ruleId);
}
