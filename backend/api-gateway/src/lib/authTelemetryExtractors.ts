import {
  AUTH_PRIVILEGE_CHANGE_EVENT_TYPE,
  AUTH_REMOTE_LOGON_EVENT_TYPE,
  AuthTelemetryColumns,
} from '../types/authTelemetry';

const EMPTY_COLUMNS: AuthTelemetryColumns = {
  authAccount: null,
  authHost: null,
  authGrantedTo: null,
  authSourceHost: null,
};

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Extract structured auth fields from `auth.remote_logon` payload.
 * Contract: { account, targetHost, sourceHost?, logonType? }
 * Returns null when required fields are absent.
 */
export function extractRemoteLogonAuthFields(
  payload: Record<string, unknown>
): AuthTelemetryColumns | null {
  const authAccount = nonEmptyString(payload.account);
  const authHost = nonEmptyString(payload.targetHost);
  if (!authAccount || !authHost) {
    return null;
  }
  return {
    authAccount,
    authHost,
    authGrantedTo: null,
    authSourceHost: nonEmptyString(payload.sourceHost),
  };
}

/**
 * Extract structured auth fields from `auth.privilege_change` payload.
 * Contract: { account, host, grantedTo?, mechanism? }
 * Returns null when required fields are absent.
 */
export function extractPrivilegeChangeAuthFields(
  payload: Record<string, unknown>
): AuthTelemetryColumns | null {
  const authAccount = nonEmptyString(payload.account);
  const authHost = nonEmptyString(payload.host);
  if (!authAccount || !authHost) {
    return null;
  }
  return {
    authAccount,
    authHost,
    authGrantedTo: nonEmptyString(payload.grantedTo),
    authSourceHost: null,
  };
}

/**
 * Map eventType + payload to nullable TelemetryEvent auth columns at ingest.
 * Non-auth event types and incomplete payloads yield all-null columns.
 */
export function authTelemetryColumnsForEvent(
  eventType: string,
  payload: Record<string, unknown>
): AuthTelemetryColumns {
  if (eventType === AUTH_REMOTE_LOGON_EVENT_TYPE) {
    return extractRemoteLogonAuthFields(payload) ?? EMPTY_COLUMNS;
  }
  if (eventType === AUTH_PRIVILEGE_CHANGE_EVENT_TYPE) {
    return extractPrivilegeChangeAuthFields(payload) ?? EMPTY_COLUMNS;
  }
  return EMPTY_COLUMNS;
}
