import {
  TELEMETRY_EVENT_TYPES,
  type TelemetryEventTypeV1,
} from "./contract";

/**
 * Query-string contract for GET /v1/telemetry/events.
 *
 * Deferred: full-text search, cursor pagination, cross-agent fan-out,
 * correlation facets.
 */

export const TELEMETRY_QUERY_DEFAULT_LIMIT = 50;
export const TELEMETRY_QUERY_MAX_LIMIT = 100;
export const TELEMETRY_QUERY_MAX_OFFSET = 10_000;
/** Max span between since and until when both are provided. */
export const TELEMETRY_QUERY_MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TelemetryQueryV1 {
  agentId: string;
  eventType?: TelemetryEventTypeV1;
  since?: Date;
  until?: Date;
  limit: number;
  offset: number;
}

export type ParseTelemetryQueryResult =
  | { ok: true; query: TelemetryQueryV1 }
  | { ok: false; message: string };

export interface ParseTelemetryQueryOptions {
  /**
   * When the principal is an agent, this is set and becomes the only allowed
   * agent scope. When the principal is a human operator, leave undefined and
   * require agentId in the query string.
   */
  principalAgentId?: string;
}

function isEventType(value: string): value is TelemetryEventTypeV1 {
  return (TELEMETRY_EVENT_TYPES as readonly string[]).includes(value);
}

function readSingle(
  value: unknown,
): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }
  return undefined;
}

function parseIsoBound(raw: string, label: string): { ok: true; date: Date } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: `${label} must be an ISO-8601 timestamp` };
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return { ok: false, message: `${label} must be a valid timestamp` };
  }
  return { ok: true, date };
}

/**
 * Parses GET query params into a bounded telemetry query.
 *
 * Tenant id is never accepted here ΓÇö it comes from the principal only.
 */
export function parseTelemetryQueryV1(
  raw: unknown,
  options: ParseTelemetryQueryOptions = {},
): ParseTelemetryQueryResult {
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
  let agentId: string;

  if (options.principalAgentId) {
    const principalAgentId = options.principalAgentId.trim().toLowerCase();
    if (agentIdRaw && agentIdRaw !== principalAgentId) {
      return { ok: false, message: "agent identity mismatch" };
    }
    agentId = principalAgentId;
  } else {
    if (!agentIdRaw || !UUID.test(agentIdRaw)) {
      return { ok: false, message: "agentId is required and must be a UUID" };
    }
    agentId = agentIdRaw;
  }

  let eventType: TelemetryEventTypeV1 | undefined;
  const eventTypeRaw = readSingle(params.eventType)?.trim();
  if (eventTypeRaw !== undefined) {
    if (!isEventType(eventTypeRaw)) {
      return { ok: false, message: "eventType is not a supported v1 type" };
    }
    eventType = eventTypeRaw;
  }

  let since: Date | undefined;
  const sinceRaw = readSingle(params.since);
  if (sinceRaw !== undefined) {
    const parsed = parseIsoBound(sinceRaw, "since");
    if (!parsed.ok) {
      return parsed;
    }
    since = parsed.date;
  }

  let until: Date | undefined;
  const untilRaw = readSingle(params.until);
  if (untilRaw !== undefined) {
    const parsed = parseIsoBound(untilRaw, "until");
    if (!parsed.ok) {
      return parsed;
    }
    until = parsed.date;
  }

  if (since && until && until.getTime() < since.getTime()) {
    return { ok: false, message: "until must be greater than or equal to since" };
  }

  if (
    since &&
    until &&
    until.getTime() - since.getTime() > TELEMETRY_QUERY_MAX_WINDOW_MS
  ) {
    return { ok: false, message: "time window exceeds maximum of 30 days" };
  }

  let limit = TELEMETRY_QUERY_DEFAULT_LIMIT;
  const limitRaw = readSingle(params.limit);
  if (limitRaw !== undefined) {
    const value = Number(limitRaw);
    if (
      !Number.isInteger(value) ||
      value < 1 ||
      value > TELEMETRY_QUERY_MAX_LIMIT
    ) {
      return {
        ok: false,
        message: `limit must be an integer from 1 to ${TELEMETRY_QUERY_MAX_LIMIT}`,
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
      value > TELEMETRY_QUERY_MAX_OFFSET
    ) {
      return {
        ok: false,
        message: `offset must be an integer from 0 to ${TELEMETRY_QUERY_MAX_OFFSET}`,
      };
    }
    offset = value;
  }

  return {
    ok: true,
    query: {
      agentId,
      ...(eventType ? { eventType } : {}),
      ...(since ? { since } : {}),
      ...(until ? { until } : {}),
      limit,
      offset,
    },
  };
}
