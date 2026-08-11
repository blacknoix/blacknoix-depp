import type { AlertsRepository, AlertRow, ListAlertsQuery } from "./repository";

export interface AlertEvidence {
  ruleId: string;
  windowStart: string;
  windowEnd: string;
  windowBucket: string;
  contributingCount: number;
  contributingEventIds: string[];
}

export interface AlertListItem {
  id: string;
  agentId: string;
  ruleId: string;
  createdAt: string;
  evidence: AlertEvidence;
}

export interface AlertsService {
  list(
    tenantId: string,
    query?: ListAlertsQuery,
  ): Promise<AlertListItem[]>;

  getById(
    tenantId: string,
    alertId: string,
  ): Promise<AlertListItem | undefined>;
}

function toListItem(row: AlertRow): AlertListItem {
  return {
    id: row.id,
    agentId: row.agentId,
    ruleId: row.ruleId,
    createdAt: row.createdAt.toISOString(),
    evidence: {
      ruleId: row.ruleId,
      windowStart: row.windowStart.toISOString(),
      windowEnd: row.windowEnd.toISOString(),
      windowBucket: row.windowBucket.toISOString(),
      contributingCount: row.contributingCount,
      contributingEventIds: [...row.contributingEventIds],
    },
  };
}

export function createAlertsService(deps: {
  alerts: AlertsRepository;
}): AlertsService {
  const { alerts } = deps;

  return {
    async list(tenantId, query) {
      const rows = await alerts.listAlerts(tenantId, query);
      return rows.map(toListItem);
    },

    async getById(tenantId, alertId) {
      const row = await alerts.getAlertById(tenantId, alertId);
      return row ? toListItem(row) : undefined;
    },
  };
}
