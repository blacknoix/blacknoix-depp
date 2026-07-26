/**
 * Narrow URL-carried cross-link state between Agents and Findings.
 *
 * - /agents?freshness=&hasOpenFindings=&agentId=
 * - /findings?status=&ruleId=&agentId=&findingId=
 *
 * Invalid UUIDs / enums fail closed (ignored + surfaced). No global search /
 * deep-link framework — only these operator-workflow params.
 */

import {
  serializeAgentsSearchParams,
  type AgentsFilters,
} from "./agentsUrlState";
import {
  serializeFindingsSearchParams,
  type FindingsUrlWrite,
} from "./findingsUrlState";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type UuidParamResult =
  | { ok: true; present: false }
  | { ok: true; present: true; id: string }
  | { ok: false; present: true; raw: string };

export function parseUuidQueryParam(raw: string | null): UuidParamResult {
  if (raw === null || raw.trim() === "") {
    return { ok: true, present: false };
  }
  const trimmed = raw.trim().toLowerCase();
  if (!UUID.test(trimmed)) {
    return { ok: false, present: true, raw };
  }
  return { ok: true, present: true, id: trimmed };
}

export function agentsPath(
  opts?: string | (AgentsFilters & { agentId?: string }),
): string {
  if (typeof opts === "string") {
    return agentsPath({ agentId: opts });
  }
  if (!opts) {
    return "/agents";
  }
  const params = serializeAgentsSearchParams({
    filters: {
      ...(opts.freshness ? { freshness: opts.freshness } : {}),
      ...(opts.hasOpenFindings ? { hasOpenFindings: true } : {}),
    },
    agentId: opts.agentId ?? null,
  });
  const qs = params.toString();
  return qs ? `/agents?${qs}` : "/agents";
}

export function findingsPath(
  opts?: FindingsUrlWrite["filters"] & { findingId?: string },
): string {
  const params = serializeFindingsSearchParams({
    filters: {
      ...(opts?.status ? { status: opts.status } : {}),
      ...(opts?.ruleId ? { ruleId: opts.ruleId } : {}),
      ...(opts?.agentId ? { agentId: opts.agentId } : {}),
    },
    findingId: opts?.findingId,
  });
  const qs = params.toString();
  return qs ? `/findings?${qs}` : "/findings";
}
