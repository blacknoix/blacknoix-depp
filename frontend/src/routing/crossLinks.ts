/**
 * Narrow URL-carried cross-link state between Agents and Findings.
 *
 * - /agents?agentId=<uuid>
 * - /findings?agentId=<uuid>&findingId=<uuid>
 *
 * Invalid UUIDs fail closed (ignored + surfaced). No global search / deep-link
 * framework — only these operator-workflow params.
 */

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

export function agentsPath(agentId?: string): string {
  if (!agentId) {
    return "/agents";
  }
  return `/agents?agentId=${encodeURIComponent(agentId)}`;
}

export function findingsPath(opts?: {
  agentId?: string;
  findingId?: string;
}): string {
  const params = new URLSearchParams();
  if (opts?.agentId) {
    params.set("agentId", opts.agentId);
  }
  if (opts?.findingId) {
    params.set("findingId", opts.findingId);
  }
  const qs = params.toString();
  return qs ? `/findings?${qs}` : "/findings";
}
