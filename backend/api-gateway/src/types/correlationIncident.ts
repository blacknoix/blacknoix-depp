/** Correlation v2 incident kinds. */
export type CorrelatedIncidentType =
  | 'malware_outbreak'
  | 'lateral_movement_privilege_escalation'
  | 'telemetry_gap_after_alert';

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

/**
 * First-guess defaults for telemetry-gap detection — tune on real tenant data.
 * See docs/correlation-v2.md; not validated against production traffic.
 */
export const GAP_BASELINE_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** Follow-on window after a high/critical alert to observe volume drop. */
export const GAP_WINDOW_MS = 20 * 60 * 1000;

/** Gap-window hourly rate must be below this fraction of the agent's baseline hourly rate. */
export const DROP_THRESHOLD_FRACTION = 0.1;

/** Fire when fewer than this fraction of peer agents are also degraded (agent is outlier). */
export const MIN_PEER_NORMAL_FRACTION = 0.25;

/** Suppress when at or above this fraction of peers are degraded (shared outage). */
export const MAX_PEER_DEGRADED_FRACTION = 0.5;

/** Below this tenant agent count, use absolute normal-peer floor instead of ratio. */
export const SMALL_FLEET_SIZE = 5;

/** Small-fleet mode: require at least this many other agents clearly normal. */
export const SMALL_FLEET_MIN_NORMAL = 2;

/** Runner alert lookback: baseline + gap + margin. */
export const GAP_ALERT_LOOKBACK_MS = GAP_BASELINE_LOOKBACK_MS + GAP_WINDOW_MS;

export const TELEMETRY_GAP_TRIGGER_SEVERITIES = ['high', 'critical'] as const;

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
  /** Baseline hourly event rate for `telemetry_gap_after_alert`. */
  baselineVolume?: number;
  /** Observed events in the gap window for `telemetry_gap_after_alert`. */
  observedVolume?: number;
  /** Fraction of peer agents also degraded for `telemetry_gap_after_alert`. */
  degradedPeerFraction?: number;
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

export interface TelemetryGapPeerVolume {
  agentId: string;
  baselineEventsPerHour: number;
  gapObservedCount: number;
}

export interface TelemetryGapEvaluationInput {
  tenantId: string;
  alertId: string;
  agentId: string;
  alertTime: Date;
  agentBaselineEventsPerHour: number;
  agentGapObservedCount: number;
  peers: TelemetryGapPeerVolume[];
  totalTenantAgentCount: number;
}

export interface TelemetryGapDetectionOptions {
  gapWindowMs: number;
  dropThresholdFraction: number;
  minPeerNormalFraction: number;
  maxPeerDegradedFraction: number;
  smallFleetSize: number;
  smallFleetMinNormal: number;
}
