/** Correlation v2 incident kinds. Only `malware_outbreak` in this slice. */
export type CorrelatedIncidentType = 'malware_outbreak';

/** Rolling window for outbreak detection — same 24h horizon as tenant overview. */
export const OUTBREAK_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Minimum distinct agents sharing an indicator within the window to raise an outbreak. */
export const OUTBREAK_MIN_AGENTS = 3;

/** How far back the runner reads indicator-bearing alerts (matches detection window). */
export const OUTBREAK_LOOKBACK_MS = OUTBREAK_WINDOW_MS;

export interface CorrelatedIncident {
  id: string;
  tenantId: string;
  type: CorrelatedIncidentType;
  indicator: string;
  agentIds: string[];
  alertIds: string[];
  firstSeen: Date;
  lastSeen: Date;
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
