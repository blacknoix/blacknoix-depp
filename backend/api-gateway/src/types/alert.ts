export type AlertStatus = 'open' | 'acknowledged' | 'resolved';

export const ALERT_TRIGGER_SEVERITIES = ['high', 'critical'] as const;

export const ALERT_STATUS_TRANSITIONS: Record<AlertStatus, AlertStatus[]> = {
  open: ['acknowledged'],
  acknowledged: ['resolved'],
  resolved: [],
};

export interface AlertSummary {
  id: string;
  tenantId: string;
  agentId: string;
  telemetryEventId: string | null;
  title: string;
  severity: string;
  status: AlertStatus;
  assignedToId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AlertDetail extends AlertSummary {
  resolvedAt: Date | null;
}

export interface UpdateAlertInput {
  status?: AlertStatus;
  assignedToUserId?: string | null;
}

export interface AlertFilterParams {
  status?: AlertStatus;
  severity?: string;
  agentId?: string;
  limit: number;
  before?: Date;
}

export class AlertValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlertValidationError';
  }
}
