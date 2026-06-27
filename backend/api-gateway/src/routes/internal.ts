import { Router, Response } from 'express';
import { getMetricsSnapshot } from '../lib/metrics';
import { tenantScoped } from '../middleware/tenantScoped';
import { requireRole } from '../middleware/requireRole';

export const internalRouter = Router();

// Operator-only in-process metrics (admin+ JWT required).
internalRouter.use(...tenantScoped);

/**
 * GET /internal/metrics
 * Returns in-memory auth and access-control counters.
 */
internalRouter.get('/metrics', requireRole('admin'), (_req, res: Response): void => {
  res.json(getMetricsSnapshot());
});
