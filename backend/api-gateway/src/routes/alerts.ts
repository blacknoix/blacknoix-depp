import { Router, Response } from 'express';
import { hashClientIp, logAuthEvent } from '../lib/authAudit';
import { readTenantFromRequest } from '../lib/tenantScope';
import { requireRole } from '../middleware/requireRole';
import { getAlert, listAlerts, updateAlert } from '../services/alertService';
import { AlertFilterParams, AlertStatus, AlertValidationError, UpdateAlertInput } from '../types/alert';

export const alertRouter = Router();

const VALID_STATUSES: AlertStatus[] = ['open', 'acknowledged', 'resolved'];
const PATCHABLE_STATUSES: AlertStatus[] = ['acknowledged', 'resolved'];

function parseLimit(raw: unknown): number {
  if (typeof raw !== 'string') {
    return 50;
  }
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    return 50;
  }
  return Math.min(Math.max(parsed, 1), 200);
}

function parseBefore(raw: unknown): Date | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function auditBase(req: Parameters<typeof readTenantFromRequest>[0]) {
  const { tenantId, userId, role } = readTenantFromRequest(req);
  return {
    tenantId,
    userId,
    role,
    route: req.path,
    method: req.method,
    clientIpHash: hashClientIp(req),
  };
}

function hasListFilters(filters: Pick<AlertFilterParams, 'status' | 'severity' | 'agentId' | 'ruleId' | 'indicator'>): boolean {
  return Boolean(filters.status || filters.severity || filters.agentId || filters.ruleId || filters.indicator);
}

function isFirstPage(filters: Pick<AlertFilterParams, 'before'>): boolean {
  return filters.before === undefined;
}

function shouldAuditList(filters: AlertFilterParams): boolean {
  return hasListFilters(filters) || isFirstPage(filters);
}

/**
 * GET /api/alerts
 * List alerts in the caller's tenant with optional filters.
 */
alertRouter.get('/', requireRole('analyst'), async (req, res: Response): Promise<void> => {
  const base = auditBase(req);
  const { tenantId } = base;

  let status: AlertStatus | undefined;
  if (typeof req.query.status === 'string' && VALID_STATUSES.includes(req.query.status as AlertStatus)) {
    status = req.query.status as AlertStatus;
  }

  const severity = typeof req.query.severity === 'string' ? req.query.severity : undefined;
  const agentId = typeof req.query.agentId === 'string' ? req.query.agentId : undefined;
  const ruleId = typeof req.query.ruleId === 'string' ? req.query.ruleId : undefined;
  const indicator = typeof req.query.indicator === 'string' ? req.query.indicator : undefined;

  const filters: AlertFilterParams = {
    status,
    severity,
    agentId,
    ruleId,
    indicator,
    limit: parseLimit(req.query.limit),
    before: parseBefore(req.query.before),
  };

  const alerts = await listAlerts(tenantId, filters);

  if (shouldAuditList(filters)) {
    logAuthEvent({
      action: 'alert_list',
      outcome: 'success',
      httpStatus: 200,
      ...base,
      meta: {
        count: alerts.length,
        ...(status ? { status } : {}),
        ...(severity ? { severity } : {}),
        ...(agentId ? { agentId } : {}),
        ...(ruleId ? { ruleId } : {}),
        ...(indicator ? { indicator } : {}),
        ...(filters.before ? { paginated: true } : {}),
      },
    });
  }

  res.json(alerts);
});

/**
 * GET /api/alerts/:alertId
 * Get a single alert in the caller's tenant.
 */
alertRouter.get('/:alertId', requireRole('analyst'), async (req, res: Response): Promise<void> => {
  const base = auditBase(req);
  const { tenantId } = base;
  const alert = await getAlert(tenantId, req.params.alertId);

  if (!alert) {
    logAuthEvent({
      action: 'alert_access_denied',
      outcome: 'denied',
      httpStatus: 404,
      ...base,
      alertId: req.params.alertId,
    });
    res.status(404).json({ error: 'Alert not found' });
    return;
  }

  logAuthEvent({
    action: 'alert_read',
    outcome: 'success',
    httpStatus: 200,
    ...base,
    alertId: alert.id,
    meta: { alertId: alert.id, ruleId: alert.ruleId ?? '' },
  });

  res.json(alert);
});

/**
 * PATCH /api/alerts/:alertId
 * Triage an alert — update status and/or assignee.
 */
alertRouter.patch('/:alertId', requireRole('analyst'), async (req, res: Response): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  const input: UpdateAlertInput = {};

  if ('status' in body) {
    if (typeof body.status !== 'string' || !PATCHABLE_STATUSES.includes(body.status as AlertStatus)) {
      res.status(400).json({ error: 'Invalid status value' });
      return;
    }
    input.status = body.status as AlertStatus;
  }

  if ('assignedToUserId' in body) {
    input.assignedToUserId =
      body.assignedToUserId === null ? null : (body.assignedToUserId as string);
  }

  if (Object.keys(input).length === 0) {
    res.status(400).json({ error: 'No fields to update' });
    return;
  }

  const base = auditBase(req);
  const { tenantId, userId, role } = base;

  let alert: Awaited<ReturnType<typeof updateAlert>>;
  try {
    alert = await updateAlert(tenantId, req.params.alertId, input, { userId, role });
  } catch (err) {
    if (err instanceof AlertValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  if (!alert) {
    logAuthEvent({
      action: 'alert_access_denied',
      outcome: 'denied',
      httpStatus: 404,
      ...base,
      alertId: req.params.alertId,
    });
    res.status(404).json({ error: 'Alert not found' });
    return;
  }

  res.json(alert);
});
