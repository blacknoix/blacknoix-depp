/** Correlation v2 incident kinds. */
export type CorrelatedIncidentType =
  | 'malware_outbreak'
  | 'lateral_movement_privilege_escalation';

/** Rolling window for outbreak detection — same 24h horizon as tenant overview. */
export const OUTBREAK_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Minimum distinct agents sharing an indicator within the window to raise an outbreak. */
export const OUTBREAK_MIN_AGENTS = 3;

/** How far back the runner reads indicator-bearing alerts (matches detection window). */
export const OUTBREAK_LOOKBACK_MS = OUTBREAK_WINDOW_MS;

/** W1: span in which minHosts distinct authHost values must be reached via remote_logon. */
export const LATERAL_WINDOW_MS = 30 * 60 * 1000;

/** Minimum distinct authHost values for the same authAccount within LATERAL_WINDOW_MS. */
export const LATERAL_MIN_HOSTS = 3;

/** W2: window after the last qualifying logon in which privilege_change must occur. */
export const ESCALATION_FOLLOWUP_MS = 15 * 60 * 1000;

/** Runner lookback: W1 plus W2 follow-up. */
export const LATERAL_LOOKBACK_MS = LATERAL_WINDOW_MS + ESCALATION_FOLLOWUP_MS;

export interface CorrelatedIncident {
  id: string;
  tenantId: string;
  type: CorrelatedIncidentType;
  indicator: string;
  agentIds: string[];
  alertIds: string[];
  firstSeen: Date;
  lastSeen: Date;
  /** Privilege-change time for `lateral_movement_privilege_escalation` (equals `lastSeen`). */
  escalatedAt?: Date;
  agentCount: number;
  createdAt: Date;
}

/** Minimal alert row for pure outbreak detection (no DB). */
export interface OutbreakAlertRow {
  id: string;
  tenantId: string;
  agentId: string;
  indicator: string | null;
  createdAt: Date;
}

export interface OutbreakDetectionOptions {
  windowMs: number;
  minAgents: number;
}

/** Minimal auth telemetry row for pure lateral-movement detection (no DB). */
export interface AuthTelemetryRow {
  id: string;
  tenantId: string;
  agentId: string;
  eventType: string;
  authAccount: string;
  authHost: string | null;
  occurredAt: Date;
}

export interface LateralMovementDetectionOptions {
  hostWindowMs: number;
  minHosts: number;
  escalationWindowMs: number;
}
