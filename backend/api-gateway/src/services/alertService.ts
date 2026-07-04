import { prisma } from '../lib/prisma';
import { logAuthEvent } from '../lib/authAudit';
import { recordAlertUpdated } from '../lib/metrics';
import { tenantOwnedWhere, tenantWhere } from '../lib/tenantScope';
import {
  ALERT_STATUS_TRANSITIONS,
  AlertDetail,
  AlertFilterParams,
  AlertStatus,
  AlertSummary,
  AlertActor,
  AlertValidationError,
  UpdateAlertInput,
} from '../types/alert';

const ALERT_SUMMARY_SELECT = {
  id: true,
  tenantId: true,
  agentId: true,
  telemetryEventId: true,
  title: true,
  severity: true,
  status: true,
  ruleId: true,
  indicator: true,
  assignedToId: true,
  createdAt: true,
  updatedAt: true,
} as const;

const ALERT_DETAIL_SELECT = {
  ...ALERT_SUMMARY_SELECT,
  resolvedAt: true,
} as const;

function toAlertStatus(status: string): AlertStatus {
  const valid: AlertStatus[] = ['open', 'acknowledged', 'resolved'];
  return valid.includes(status as AlertStatus) ? (status as AlertStatus) : 'open';
}

function toAlertSummary(row: {
  id: string;
  tenantId: string;
  agentId: string;
  telemetryEventId: string | null;
  title: string;
  severity: string;
  status: string;
  ruleId: string | null;
  indicator: string | null;
  assignedToId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): AlertSummary {
  return {
    id: row.id,
    tenantId: row.tenantId,
    agentId: row.agentId,
    telemetryEventId: row.telemetryEventId,
    title: row.title,
    severity: row.severity,
    status: toAlertStatus(row.status),
    ruleId: row.ruleId,
    indicator: row.indicator,
    assignedToId: row.assignedToId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toAlertDetail(row: {
  id: string;
  tenantId: string;
  agentId: string;
  telemetryEventId: string | null;
  title: string;
  severity: string;
  status: string;
  ruleId: string | null;
  indicator: string | null;
  assignedToId: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): AlertDetail {
  return {
    ...toAlertSummary(row),
    resolvedAt: row.resolvedAt,
  };
}

/** List alerts for a tenant with optional filters and cursor pagination. */
export async function listAlerts(
  tenantId: string,
  filters: AlertFilterParams
): Promise<AlertSummary[]> {
  const alerts = await prisma.alert.findMany({
    where: {
      ...tenantWhere(tenantId),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.severity ? { severity: filters.severity } : {}),
      ...(filters.agentId ? { agentId: filters.agentId } : {}),
      ...(filters.ruleId ? { ruleId: filters.ruleId } : {}),
      ...(filters.indicator ? { indicator: filters.indicator } : {}),
      ...(filters.before ? { createdAt: { lt: filters.before } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: filters.limit,
    select: ALERT_SUMMARY_SELECT,
  });

  return alerts.map(toAlertSummary);
}

/** Get a single alert scoped to a tenant. Returns null for cross-tenant ids. */
export async function getAlert(tenantId: string, alertId: string): Promise<AlertDetail | null> {
  const alert = await prisma.alert.findFirst({
    where: tenantOwnedWhere(tenantId, alertId),
    select: ALERT_DETAIL_SELECT,
  });

  if (!alert) {
    return null;
  }

  return toAlertDetail(alert as Parameters<typeof toAlertDetail>[0]);
}

/** Update alert status and/or assignee with forward-only status transitions. */
export async function updateAlert(
  tenantId: string,
  alertId: string,
  input: UpdateAlertInput,
  actor?: AlertActor
): Promise<AlertDetail | null> {
  const alert = await prisma.alert.findFirst({
    where: tenantOwnedWhere(tenantId, alertId),
    select: { id: true, status: true },
  });

  if (!alert) {
    return null;
  }

  const previousStatus = toAlertStatus(alert.status);

  const data: {
    status?: AlertStatus;
    assignedToId?: string | null;
    resolvedAt?: Date;
  } = {};

  if (input.status !== undefined) {
    const allowed = ALERT_STATUS_TRANSITIONS[previousStatus];
    if (!allowed.includes(input.status)) {
      throw new AlertValidationError(
        `Cannot transition from ${previousStatus} to ${input.status}`
      );
    }
    data.status = input.status;
    if (input.status === 'resolved') {
      data.resolvedAt = new Date();
    }
  }

  if ('assignedToUserId' in input) {
    if (input.assignedToUserId === null) {
      data.assignedToId = null;
    } else if (input.assignedToUserId !== undefined) {
      const user = await prisma.user.findFirst({
        where: { id: input.assignedToUserId, tenantId },
        select: { id: true },
      });
      if (!user) {
        throw new AlertValidationError('Assignee not found in this tenant');
      }
      data.assignedToId = input.assignedToUserId;
    }
  }

  const updated = await prisma.alert.update({
    where: { id: alertId },
    data,
    select: ALERT_DETAIL_SELECT,
  });

  const detail = toAlertDetail(updated as Parameters<typeof toAlertDetail>[0]);
  const newStatus = detail.status;

  if (actor) {
    logAuthEvent({
      action: 'alert_updated',
      outcome: 'success',
      tenantId,
      userId: actor.userId,
      role: actor.role,
      alertId,
      meta: {
        alertId,
        previousStatus,
        newStatus,
      },
    });
    recordAlertUpdated();
  }

  return detail;
}
