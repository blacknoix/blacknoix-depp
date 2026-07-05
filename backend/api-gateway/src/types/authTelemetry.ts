/** Agent contract: remote interactive or network logon to a host. */
export const AUTH_REMOTE_LOGON_EVENT_TYPE = 'auth.remote_logon';

/** Agent contract: privilege elevation on a host (e.g. admin grant). */
export const AUTH_PRIVILEGE_CHANGE_EVENT_TYPE = 'auth.privilege_change';

export const AUTH_TELEMETRY_EVENT_TYPES = [
  AUTH_REMOTE_LOGON_EVENT_TYPE,
  AUTH_PRIVILEGE_CHANGE_EVENT_TYPE,
] as const;

export type AuthTelemetryEventType = (typeof AUTH_TELEMETRY_EVENT_TYPES)[number];

/** Columns persisted on TelemetryEvent when extraction succeeds. */
export interface AuthTelemetryColumns {
  authAccount: string | null;
  authHost: string | null;
  authGrantedTo: string | null;
  authSourceHost: string | null;
}

export interface AuthTelemetryQueryParams {
  eventType?: AuthTelemetryEventType;
  authAccount?: string;
  since?: Date;
  until?: Date;
  limit: number;
}
