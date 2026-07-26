import {
  isCorrelationRuleId,
  type CorrelationRuleId,
} from "../correlation/rules";
import {
  isFindingStatus,
  type FindingStatus,
} from "../correlation/lifecycle";

/**
 * Create-body contract for POST /v1/findings/views.
 * findingId is rejected if present. Tenant id never accepted from body.
 */

export const SHARED_VIEW_NAME_MAX = 40;
export const SHARED_VIEWS_MAX_PER_TENANT = 32;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SharedFindingViewFilters {
  status?: FindingStatus;
  ruleId?: CorrelationRuleId;
  agentId?: string;
}

export interface CreateSharedFindingViewInput {
  name: string;
  filters: SharedFindingViewFilters;
}

export type ParseCreateSharedViewResult =
  | { ok: true; input: CreateSharedFindingViewInput }
  | { ok: false; message: string };

function normalizeName(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length === 0 || name.length > SHARED_VIEW_NAME_MAX) {
    return null;
  }
  return name;
}

/**
 * Parses POST body: `{ name, filters: { status?, ruleId?, agentId? } }`.
 * Empty filters (all findings) are allowed.
 */
export function parseCreateSharedFindingViewBody(
  body: unknown,
): ParseCreateSharedViewResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "body must be a JSON object" };
  }
  const record = body as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (key === "tenantId" || key === "tenant_id" || key === "tid") {
      return {
        ok: false,
        message: "tenant identity must not be supplied in the body",
      };
    }
  }

  const name = normalizeName(record.name);
  if (!name) {
    return {
      ok: false,
      message: `name must be 1–${SHARED_VIEW_NAME_MAX} characters`,
    };
  }

  if (!("filters" in record)) {
    return { ok: false, message: "filters is required" };
  }
  if (
    typeof record.filters !== "object" ||
    record.filters === null ||
    Array.isArray(record.filters)
  ) {
    return { ok: false, message: "filters must be an object" };
  }

  const filtersRaw = record.filters as Record<string, unknown>;
  if ("findingId" in filtersRaw) {
    return {
      ok: false,
      message: "findingId must not be stored on a shared view",
    };
  }

  const filters: SharedFindingViewFilters = {};

  if ("status" in filtersRaw && filtersRaw.status !== undefined) {
    if (typeof filtersRaw.status !== "string" || !isFindingStatus(filtersRaw.status)) {
      return { ok: false, message: "status is not a valid finding status" };
    }
    filters.status = filtersRaw.status;
  }

  if ("ruleId" in filtersRaw && filtersRaw.ruleId !== undefined) {
    if (
      typeof filtersRaw.ruleId !== "string" ||
      !isCorrelationRuleId(filtersRaw.ruleId)
    ) {
      return { ok: false, message: "ruleId is not a known correlation rule" };
    }
    filters.ruleId = filtersRaw.ruleId;
  }

  if ("agentId" in filtersRaw && filtersRaw.agentId !== undefined) {
    if (
      typeof filtersRaw.agentId !== "string" ||
      !UUID.test(filtersRaw.agentId.trim())
    ) {
      return { ok: false, message: "agentId must be a UUID" };
    }
    filters.agentId = filtersRaw.agentId.trim().toLowerCase();
  }

  return { ok: true, input: { name, filters } };
}
