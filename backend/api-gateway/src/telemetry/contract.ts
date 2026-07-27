/**
 * Telemetry contract v1 — auth/liveness signals only.
 *
 * Deferred (do not absorb here): malware/detection event types, compression,
 * agent-side spooling, correlation fields, mutable presentation metadata.
 *
 * Tenant identity is NEVER part of this contract. Callers that put tenantId
 * (or similar) in the body are rejected so they cannot believe the server
 * trusted a payload-derived tenant.
 *
 * Batch ingest is all-or-nothing: every event must validate or none are
 * accepted. Max event count is enforced by the caller (route/config).
 */

export const TELEMETRY_SCHEMA_VERSION = 1 as const;

export const TELEMETRY_EVENT_TYPES = [
  "heartbeat",
  "agent.started",
  "agent.stopped",
] as const;

export type TelemetryEventTypeV1 = (typeof TELEMETRY_EVENT_TYPES)[number];

/** Allowed top-level keys for a v1 ingest body. */
const ALLOWED_KEYS = new Set([
  "schemaVersion",
  "agentId",
  "eventType",
  "occurredAt",
  "payload",
]);

/** Reject any attempt to smuggle tenant identity through the body. */
const FORBIDDEN_TENANT_KEYS = new Set([
  "tenantId",
  "tenant_id",
  "tid",
]);

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_PAYLOAD_BYTES = 4 * 1024;
const MAX_PAYLOAD_KEYS = 32;
const MAX_PAYLOAD_DEPTH = 2;
const MAX_STRING_LENGTH = 512;

/** Reject events claimed more than this far in the future (clock skew). */
const MAX_FUTURE_MS = 60_000;

/** Reject events older than this (stale / replay-ish for v1). */
const MAX_PAST_MS = 7 * 24 * 60 * 60 * 1000;

export interface TelemetryEventV1 {
  schemaVersion: typeof TELEMETRY_SCHEMA_VERSION;
  agentId: string;
  eventType: TelemetryEventTypeV1;
  occurredAt: Date;
  payload: Record<string, unknown>;
}

export type ParseTelemetryResult =
  | { ok: true; event: TelemetryEventV1 }
  | { ok: false; message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEventType(value: unknown): value is TelemetryEventTypeV1 {
  return (
    typeof value === "string" &&
    (TELEMETRY_EVENT_TYPES as readonly string[]).includes(value)
  );
}

function validatePayloadValue(
  value: unknown,
  depth: number,
): string | undefined {
  if (depth > MAX_PAYLOAD_DEPTH) {
    return "payload nesting exceeds depth limit";
  }

  if (value === null || typeof value === "boolean" || typeof value === "number") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      return "payload numbers must be finite";
    }
    return undefined;
  }

  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH) {
      return "payload string exceeds length limit";
    }
    return undefined;
  }

  if (Array.isArray(value)) {
    return "payload must not contain arrays";
  }

  if (!isPlainObject(value)) {
    return "payload contains unsupported value types";
  }

  const keys = Object.keys(value);
  if (keys.length > MAX_PAYLOAD_KEYS) {
    return "payload object exceeds key limit";
  }

  for (const key of keys) {
    if (typeof key !== "string" || key.length === 0 || key.length > MAX_STRING_LENGTH) {
      return "payload key is invalid";
    }
    const nested = validatePayloadValue(value[key], depth + 1);
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

function validatePayload(payload: Record<string, unknown>): string | undefined {
  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    return "payload is not JSON-serializable";
  }

  if (serialized.length > MAX_PAYLOAD_BYTES) {
    return "payload exceeds size limit";
  }

  return validatePayloadValue(payload, 0);
}

/**
 * Parses and validates a single v1 telemetry event body.
 *
 * Pure: no I/O, no tenant context. Callers supply tenantId separately from the
 * authenticated principal.
 */
export function parseTelemetryEventV1(body: unknown): ParseTelemetryResult {
  if (!isPlainObject(body)) {
    return { ok: false, message: "body must be a JSON object" };
  }

  for (const key of Object.keys(body)) {
    if (FORBIDDEN_TENANT_KEYS.has(key)) {
      return {
        ok: false,
        message: "tenant identity must not be supplied in the body",
      };
    }
    if (!ALLOWED_KEYS.has(key)) {
      return { ok: false, message: `unknown field: ${key}` };
    }
  }

  if (!("schemaVersion" in body)) {
    return { ok: false, message: "schemaVersion is required" };
  }
  if (body.schemaVersion !== TELEMETRY_SCHEMA_VERSION) {
    return { ok: false, message: "unsupported schemaVersion" };
  }

  if (typeof body.agentId !== "string" || !UUID.test(body.agentId)) {
    return { ok: false, message: "agentId must be a UUID" };
  }

  if (!isEventType(body.eventType)) {
    return { ok: false, message: "eventType is not a supported v1 type" };
  }

  if (typeof body.occurredAt !== "string" || body.occurredAt.trim() === "") {
    return { ok: false, message: "occurredAt must be an ISO-8601 string" };
  }

  const occurredAt = new Date(body.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) {
    return { ok: false, message: "occurredAt must be a valid timestamp" };
  }

  // Reject non-canonical forms that Date parses but round-trip poorly
  // (e.g. bare numbers as strings that become relative). Require a parseable
  // absolute time with a timezone designator via ISO-ish check: must include 'T'
  // or be date-only that Date accepts — we require the string to round-trip
  // within the window checks only.
  const now = Date.now();
  const ts = occurredAt.getTime();
  if (ts - now > MAX_FUTURE_MS) {
    return { ok: false, message: "occurredAt is too far in the future" };
  }
  if (now - ts > MAX_PAST_MS) {
    return { ok: false, message: "occurredAt is too far in the past" };
  }

  let payload: Record<string, unknown> = {};
  if ("payload" in body) {
    if (!isPlainObject(body.payload)) {
      return { ok: false, message: "payload must be a JSON object" };
    }
    payload = body.payload;
  }

  const payloadError = validatePayload(payload);
  if (payloadError) {
    return { ok: false, message: payloadError };
  }

  return {
    ok: true,
    event: {
      schemaVersion: TELEMETRY_SCHEMA_VERSION,
      agentId: body.agentId.toLowerCase(),
      eventType: body.eventType,
      occurredAt,
      payload,
    },
  };
}

/** Allowed top-level keys for a v1 batch body. */
const BATCH_ALLOWED_KEYS = new Set(["events"]);

export type ParseTelemetryBatchResult =
  | { ok: true; events: TelemetryEventV1[] }
  | { ok: false; message: string };

export interface ParseTelemetryBatchOptions {
  /** Injected from the authenticated principal — never from the body. */
  agentId: string;
  /** Inclusive upper bound on events.length (already validated by config). */
  maxEvents: number;
}

/**
 * Parses a batch body: `{ events: [ event, ... ] }`.
 *
 * All-or-nothing validation: the first invalid event fails the whole batch.
 * Each event is validated with parseTelemetryEventV1 after agentId is bound
 * from options.agentId (body agentId may only match as a consistency check).
 */
export function parseTelemetryBatchV1(
  body: unknown,
  options: ParseTelemetryBatchOptions,
): ParseTelemetryBatchResult {
  if (!isPlainObject(body)) {
    return { ok: false, message: "body must be a JSON object" };
  }

  for (const key of Object.keys(body)) {
    if (FORBIDDEN_TENANT_KEYS.has(key)) {
      return {
        ok: false,
        message: "tenant identity must not be supplied in the body",
      };
    }
    if (!BATCH_ALLOWED_KEYS.has(key)) {
      return { ok: false, message: `unknown field: ${key}` };
    }
  }

  if (!("events" in body)) {
    return { ok: false, message: "events is required" };
  }

  if (!Array.isArray(body.events)) {
    return { ok: false, message: "events must be an array" };
  }

  if (body.events.length === 0) {
    return { ok: false, message: "events must not be empty" };
  }

  if (body.events.length > options.maxEvents) {
    return {
      ok: false,
      message: `events exceeds max of ${options.maxEvents}`,
    };
  }

  const events: TelemetryEventV1[] = [];

  for (let i = 0; i < body.events.length; i++) {
    const raw = body.events[i];

    if (!isPlainObject(raw)) {
      return { ok: false, message: `events[${i}] must be a JSON object` };
    }

    if ("agentId" in raw && raw.agentId !== options.agentId) {
      return {
        ok: false,
        message: `events[${i}]: agent identity mismatch`,
      };
    }

    const bound = { ...raw, agentId: options.agentId };
    const parsed = parseTelemetryEventV1(bound);
    if (!parsed.ok) {
      return { ok: false, message: `events[${i}]: ${parsed.message}` };
    }

    events.push(parsed.event);
  }

  return { ok: true, events };
}
