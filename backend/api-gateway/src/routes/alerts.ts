import { Router, Response } from 'express';
import { readTenantFromRequest } from '../lib/tenantScope';
import { requireRole } from '../middleware/requireRole';
import { getAlert, listAlerts, updateAlert } from '../services/alertService';
import { AlertStatus, AlertValidationError, UpdateAlertInput } from '../types/alert';

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

/**
 * GET /api/alerts
 * List alerts in the caller's tenant with optional filters.
 */
alertRouter.get('/', requireRole('analyst'), async (req, res: Response): Promise<void> => {
  const { tenantId } = readTenantFromRequest(req);

  let status: AlertStatus | undefined;
  if (typeof req.query.status === 'string' && VALID_STATUSES.includes(req.query.status as AlertStatus)) {
    status = req.query.status as AlertStatus;
  }

  const severity = typeof req.query.severity === 'string' ? req.query.severity : undefined;
  const agentId = typeof req.query.agentId === 'string' ? req.query.agentId : undefined;

  const alerts = await listAlerts(tenantId, {
    status,
    severity,
    agentId,
    limit: parseLimit(req.query.limit),
    before: parseBefore(req.query.before),
  });

  res.json(alerts);
});

/**
 * GET /api/alerts/:alertId
 * Get a single alert in the caller's tenant.
 */
alertRouter.get('/:alertId', requireRole('analyst'), async (req, res: Response): Promise<void> => {
  const { tenantId } = readTenantFromRequest(req);
  const alert = await getAlert(tenantId, req.params.alertId);

  if (!alert) {
    res.status(404).json({ error: 'Alert not found' });
    return;
  }

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

  const { tenantId } = readTenantFromRequest(req);

  try {
    const alert = await updateAlert(tenantId, req.params.alertId, input);
    if (!alert) {
      res.status(404).json({ error: 'Alert not found' });
      return;
    }
    res.json(alert);
  } catch (err) {
    if (err instanceof AlertValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});
