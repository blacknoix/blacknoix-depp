import { z } from 'zod';
import { recordTelemetryContractUnknownKeysStripped } from './metrics';
import {
  AUTH_PRIVILEGE_CHANGE_EVENT_TYPE,
  AUTH_REMOTE_LOGON_EVENT_TYPE,
} from '../types/authTelemetry';

/** Current telemetry contract version — seam for future breaking payload changes. */
export const TELEMETRY_SCHEMA_VERSION = 1;

const nonEmptyString = z.string().trim().min(1, 'must be a non-empty string');

const optionalNonEmptyString = z
  .string()
  .trim()
  .min(1, 'must be a non-empty string')
  .optional();

export const malwarePayloadSchema = z.object({
  fileHash: optionalNonEmptyString,
});

export const authRemoteLogonPayloadSchema = z.object({
  account: nonEmptyString,
  targetHost: nonEmptyString,
  sourceHost: optionalNonEmptyString,
  logonType: optionalNonEmptyString,
});

export const authPrivilegeChangePayloadSchema = z.object({
  account: nonEmptyString,
  host: nonEmptyString,
  grantedTo: optionalNonEmptyString,
  mechanism: optionalNonEmptyString,
});

const MALWARE_PAYLOAD_KEYS = ['fileHash'] as const;
const AUTH_REMOTE_LOGON_PAYLOAD_KEYS = [
  'account',
  'targetHost',
  'sourceHost',
  'logonType',
] as const;
const AUTH_PRIVILEGE_CHANGE_PAYLOAD_KEYS = [
  'account',
  'host',
  'grantedTo',
  'mechanism',
] as const;

export function isMalwareEventType(eventType: string): boolean {
  return eventType.startsWith('malware.');
}

export function isKnownStrictEventType(eventType: string): boolean {
  return (
    isMalwareEventType(eventType) ||
    eventType === AUTH_REMOTE_LOGON_EVENT_TYPE ||
    eventType === AUTH_PRIVILEGE_CHANGE_EVENT_TYPE
  );
}

const schemaVersionSchema = z.number().int('must be an integer').positive('must be a positive integer');

function formatZodIssues(issues: z.ZodIssue[], prefix = ''): string[] {
  return issues.map((issue) => {
    const fieldPath = issue.path.length > 0 ? issue.path.join('.') : 'value';
    const fullPath = prefix ? `${prefix}.${fieldPath}` : fieldPath;
    return `${fullPath}: ${issue.message}`;
  });
}

function payloadSchemaForEventType(
  eventType: string
): z.ZodType<Record<string, unknown>> | null {
  if (isMalwareEventType(eventType)) {
    return malwarePayloadSchema;
  }
  if (eventType === AUTH_REMOTE_LOGON_EVENT_TYPE) {
    return authRemoteLogonPayloadSchema;
  }
  if (eventType === AUTH_PRIVILEGE_CHANGE_EVENT_TYPE) {
    return authPrivilegeChangePayloadSchema;
  }
  return null;
}

function definedPayloadKeysForEventType(eventType: string): readonly string[] | null {
  if (isMalwareEventType(eventType)) {
    return MALWARE_PAYLOAD_KEYS;
  }
  if (eventType === AUTH_REMOTE_LOGON_EVENT_TYPE) {
    return AUTH_REMOTE_LOGON_PAYLOAD_KEYS;
  }
  if (eventType === AUTH_PRIVILEGE_CHANGE_EVENT_TYPE) {
    return AUTH_PRIVILEGE_CHANGE_PAYLOAD_KEYS;
  }
  return null;
}

function hasUnknownPayloadKeys(
  payload: Record<string, unknown>,
  definedKeys: readonly string[]
): boolean {
  const allowed = new Set(definedKeys);
  return Object.keys(payload).some((key) => !allowed.has(key));
}

export interface TelemetryContractValidationInput {
  eventType: string;
  payload: Record<string, unknown>;
  schemaVersion?: unknown;
}

export type TelemetryContractValidationResult =
  | { ok: true; schemaVersion: number; payload: Record<string, unknown> }
  | { ok: false; errors: string[] };

/**
 * Progressive validation for one telemetry event.
 * Known correlation-critical event types validate required/optional fields; extra keys are stripped.
 * Unrecognized event types pass through unchanged.
 */
export function validateTelemetryEventContract(
  input: TelemetryContractValidationInput
): TelemetryContractValidationResult {
  const errors: string[] = [];
  let schemaVersion = TELEMETRY_SCHEMA_VERSION;

  if (input.schemaVersion !== undefined) {
    const versionResult = schemaVersionSchema.safeParse(input.schemaVersion);
    if (!versionResult.success) {
      errors.push(...formatZodIssues(versionResult.error.issues, 'schemaVersion'));
    } else if (versionResult.data !== TELEMETRY_SCHEMA_VERSION) {
      errors.push(
        `schemaVersion: must be ${TELEMETRY_SCHEMA_VERSION} (received ${versionResult.data})`
      );
    } else {
      schemaVersion = versionResult.data;
    }
  }

  if (!isKnownStrictEventType(input.eventType)) {
    return errors.length > 0
      ? { ok: false, errors }
      : { ok: true, schemaVersion, payload: input.payload };
  }

  const payloadSchema = payloadSchemaForEventType(input.eventType);
  const definedKeys = definedPayloadKeysForEventType(input.eventType);
  if (!payloadSchema || !definedKeys) {
    return errors.length > 0
      ? { ok: false, errors }
      : { ok: true, schemaVersion, payload: input.payload };
  }

  const payloadResult = payloadSchema.safeParse(input.payload);
  if (!payloadResult.success) {
    errors.push(...formatZodIssues(payloadResult.error.issues, 'payload'));
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const normalizedPayload = payloadResult.data!;
  if (hasUnknownPayloadKeys(input.payload, definedKeys)) {
    recordTelemetryContractUnknownKeysStripped();
  }

  return { ok: true, schemaVersion, payload: normalizedPayload };
}
