import { AgentStatus } from './agent';
import { AlertStatus } from './alert';
import { SeverityLevel, VALID_SEVERITIES } from './telemetry';

/** Rolling window for telemetry `events24h` and agent `recentlySeen` (24 hours). */
export const TENANT_OVERVIEW_WINDOW_MS = 24 * 60 * 60 * 1000;

export const TENANT_OVERVIEW_AGENT_STATUSES: readonly AgentStatus[] = [
  'pending',
  'active',
  'inactive',
  'revoked',
  'expired',
] as const;

export const TENANT_OVERVIEW_ALERT_STATUSES: readonly AlertStatus[] = [
  'open',
  'acknowledged',
  'resolved',
] as const;

export const TENANT_OVERVIEW_SEVERITIES: readonly SeverityLevel[] = VALID_SEVERITIES;

export interface TenantOverviewTenant {
  id: string;
  name: string;
}

export interface TenantOverviewAgents {
  total: number;
  byStatus: Record<AgentStatus, number>;
  recentlySeen: number;
}

export interface TenantOverviewAlerts {
  total: number;
  byStatus: Record<AlertStatus, number>;
  bySeverity: Record<SeverityLevel, number>;
}

export interface TenantOverviewTelemetry {
  events24h: number;
}

export interface TenantOverviewActivity {
  lastTelemetryReceivedAt: string | null;
  lastAlertCreatedAt: string | null;
  lastAgentSeenAt: string | null;
}

export interface TenantOverview {
  tenant: TenantOverviewTenant;
  agents: TenantOverviewAgents;
  alerts: TenantOverviewAlerts;
  telemetry: TenantOverviewTelemetry;
  activity: TenantOverviewActivity;
  generatedAt: string;
}

export function emptyAgentStatusCounts(): Record<AgentStatus, number> {
  return {
    pending: 0,
    active: 0,
    inactive: 0,
    revoked: 0,
    expired: 0,
  };
}

export function emptyAlertStatusCounts(): Record<AlertStatus, number> {
  return {
    open: 0,
    acknowledged: 0,
    resolved: 0,
  };
}

export function emptyAlertSeverityCounts(): Record<SeverityLevel, number> {
  return {
    info: 0,
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
}
