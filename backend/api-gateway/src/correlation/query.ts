import {
  isCorrelationRuleId,
  type CorrelationRuleId,
} from "./rules";
import { isFindingStatus, type FindingStatus } from "./lifecycle";

/**
 * Query-string contract for GET /v1/findings.
 *
 * Deferred: severity facets, cursor pagination, full triage console.
 */

export const FINDINGS_QUERY_DEFAULT_LIMIT = 50;
export const FINDINGS_QUERY_MAX_LIMIT = 100;
export const FINDINGS_QUERY_MAX_OFFSET = 10_000;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FindingsQueryV1 {
  agentId?: string;
  ruleId?: CorrelationRuleId;
  status?: FindingStatus;
  limit: number;
  offset: number;
}

export type ParseFindingsQueryResult =
  | { ok: true; query: FindingsQueryV1 }
  | { ok: false; message: string };

export interface ParseFindingsQueryOptions {
  /**
   * When the principal is an agent, this becomes the only allowed agent scope.
   * Humans may omit agentId to list tenant-wide.
   */
  principalAgentId?: string;
}

function readSingle(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }
  return undefined;
}

/**
 * Parses GET query params for findings list.
 * Tenant id is never accepted — it comes from the principal only.
 */
export function parseFindingsQueryV1(
  raw: unknown,
  options: ParseFindingsQueryOptions = {},
): ParseFindingsQueryResult {
  const params =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};

  for (const key of Object.keys(params)) {
    if (key === "tenantId" || key === "tenant_id" || key === "tid") {
      return {
        ok: false,
        message: "tenant identity must not be supplied in the query",
      };
    }
  }

  const agentIdRaw = readSingle(params.agentId)?.trim().toLowerCase();
  let agentId: string | undefined;

  if (options.principalAgentId) {
    const principalAgentId = options.principalAgentId.trim().toLowerCase();
    if (agentIdRaw && agentIdRaw !== principalAgentId) {
      return { ok: false, message: "agent identity mismatch" };
    }
    agentId = principalAgentId;
  } else if (agentIdRaw !== undefined) {
    if (!UUID.test(agentIdRaw)) {
      return { ok: false, message: "agentId must be a UUID" };
    }
    agentId = agentIdRaw;
  }

  let ruleId: CorrelationRuleId | undefined;
  const ruleIdRaw = readSingle(params.ruleId)?.trim();
  if (ruleIdRaw !== undefined) {
    if (!isCorrelationRuleId(ruleIdRaw)) {
      return { ok: false, message: "ruleId is not a known correlation rule" };
    }
    ruleId = ruleIdRaw;
  }

  let status: FindingStatus | undefined;
  const statusRaw = readSingle(params.status)?.trim();
  if (statusRaw !== undefined) {
    if (!isFindingStatus(statusRaw)) {
      return { ok: false, message: "status is not a valid finding status" };
    }
    status = statusRaw;
  }

  let limit = FINDINGS_QUERY_DEFAULT_LIMIT;
  const limitRaw = readSingle(params.limit);
  if (limitRaw !== undefined) {
    const value = Number(limitRaw);
    if (
      !Number.isInteger(value) ||
      value < 1 ||
      value > FINDINGS_QUERY_MAX_LIMIT
    ) {
      return {
        ok: false,
        message: `limit must be an integer from 1 to ${FINDINGS_QUERY_MAX_LIMIT}`,
      };
    }
    limit = value;
  }

  let offset = 0;
  const offsetRaw = readSingle(params.offset);
  if (offsetRaw !== undefined) {
    const value = Number(offsetRaw);
    if (
      !Number.isInteger(value) ||
      value < 0 ||
      value > FINDINGS_QUERY_MAX_OFFSET
    ) {
      return {
        ok: false,
        message: `offset must be an integer from 0 to ${FINDINGS_QUERY_MAX_OFFSET}`,
      };
    }
    offset = value;
  }

  return {
    ok: true,
    query: {
      ...(agentId ? { agentId } : {}),
      ...(ruleId ? { ruleId } : {}),
      ...(status ? { status } : {}),
      limit,
      offset,
    },
  };
}

export const OPERATOR_NOTE_MAX_LENGTH = 2000;

export interface FindingPatchInput {
  /** When present, apply a status transition (same-status = noop). */
  status?: FindingStatus;
  /**
   * When the key is present: null clears ownership; a UUID claims ownership
   * (must equal the actor's userId — assign-to-others is deferred).
   */
  ownerUserId?: string | null;
  /** When true, claim ownership as the authenticated operator. */
  claimOwner?: true;
  /**
   * When the key is present: null clears the note; a string replaces the
   * current operator note (plain text, bounded).
   */
  operatorNote?: string | null;
}

export type ParsePatchFindingResult =
  | { ok: true; patch: FindingPatchInput }
  | { ok: false; message: string };

/**
 * Parses PATCH /v1/findings/:id body.
 * Accepts any non-empty subset of: status, ownerUserId, operatorNote.
 */
export function parsePatchFindingBody(body: unknown): ParsePatchFindingResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "body must be a JSON object" };
  }

  const record = body as Record<string, unknown>;
  const allowed = new Set([
    "status",
    "ownerUserId",
    "claimOwner",
    "operatorNote",
  ]);

  for (const key of Object.keys(record)) {
    if (key === "tenantId" || key === "tenant_id" || key === "tid") {
      return {
        ok: false,
        message: "tenant identity must not be supplied in the body",
      };
    }
    if (!allowed.has(key)) {
      return { ok: false, message: `unknown field: ${key}` };
    }
  }

  const patch: FindingPatchInput = {};

  if ("status" in record) {
    if (typeof record.status !== "string" || !isFindingStatus(record.status)) {
      return { ok: false, message: "status is not a valid finding status" };
    }
    patch.status = record.status;
  }

  if ("claimOwner" in record) {
    if (record.claimOwner !== true) {
      return { ok: false, message: "claimOwner must be true when provided" };
    }
    patch.claimOwner = true;
  }

  if ("ownerUserId" in record) {
    if (record.ownerUserId === null) {
      patch.ownerUserId = null;
    } else if (typeof record.ownerUserId === "string") {
      const trimmed = record.ownerUserId.trim().toLowerCase();
      if (!UUID.test(trimmed)) {
        return { ok: false, message: "ownerUserId must be a UUID or null" };
      }
      patch.ownerUserId = trimmed;
    } else {
      return { ok: false, message: "ownerUserId must be a UUID or null" };
    }
  }

  if ("claimOwner" in patch && "ownerUserId" in patch) {
    return {
      ok: false,
      message: "claimOwner and ownerUserId cannot be combined",
    };
  }

  if ("operatorNote" in record) {
    if (record.operatorNote === null) {
      patch.operatorNote = null;
    } else if (typeof record.operatorNote === "string") {
      const trimmed = record.operatorNote.trim();
      if (trimmed.length === 0) {
        patch.operatorNote = null;
      } else if (trimmed.length > OPERATOR_NOTE_MAX_LENGTH) {
        return {
          ok: false,
          message: `operatorNote must be at most ${OPERATOR_NOTE_MAX_LENGTH} characters`,
        };
      } else {
        patch.operatorNote = trimmed;
      }
    } else {
      return { ok: false, message: "operatorNote must be a string or null" };
    }
  }

  if (
    patch.status === undefined &&
    !("ownerUserId" in patch) &&
    !("claimOwner" in patch) &&
    !("operatorNote" in patch)
  ) {
    return {
      ok: false,
      message:
        "at least one of status, ownerUserId, claimOwner, operatorNote is required",
    };
  }

  return { ok: true, patch };
}
