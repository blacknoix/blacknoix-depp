import { Router, Response } from 'express';
import { tenantScoped } from '../middleware/tenantScoped';
import { requireMatchingTenantParam } from '../middleware/requireMatchingTenantParam';
import { requireRole } from '../middleware/requireRole';
import { readTenantFromRequest } from '../lib/tenantScope';
import { getTenantProfile } from '../services/tenantService';
import { getUserInTenant } from '../services/userService';
import { getTenantOverview } from '../services/tenantOverviewService';
import { agentRouter } from './agents';
import { alertRouter } from './alerts';

export const apiRouter = Router();

// All /api routes are tenant-scoped by default.
apiRouter.use(...tenantScoped);

// Agent registration and management
apiRouter.use('/agents', agentRouter);

// Alert triage
apiRouter.use('/alerts', alertRouter);

/**
 * GET /api/tenant
 * Returns the authenticated caller's tenant profile.
 */
apiRouter.get('/tenant', requireRole('read-only'), async (req, res: Response): Promise<void> => {
  const { tenantId } = readTenantFromRequest(req);

  const tenant = await getTenantProfile(tenantId);
  if (!tenant) {
    res.status(404).json({ error: 'Tenant not found' });
    return;
  }

  res.json(tenant);
});

/**
 * GET /api/tenant/overview
 * Dashboard aggregates for the authenticated caller's tenant.
 */
apiRouter.get('/tenant/overview', requireRole('analyst'), async (req, res: Response): Promise<void> => {
  const { tenantId } = readTenantFromRequest(req);

  const overview = await getTenantOverview(tenantId);
  if (!overview) {
    res.status(404).json({ error: 'Tenant not found' });
    return;
  }

  res.json(overview);
});

/**
 * GET /api/tenants/:tenantId
 * Example of an explicit tenant param route — param must match the token.
 */
apiRouter.get(
  '/tenants/:tenantId',
  requireRole('read-only'),
  requireMatchingTenantParam('tenantId'),
  async (req, res: Response): Promise<void> => {
    const { tenantId } = readTenantFromRequest(req);

    const tenant = await getTenantProfile(tenantId);
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }

    res.json(tenant);
  }
);

/**
 * GET /api/users/:userId
 * Returns a user only when they belong to the caller's tenant.
 */
apiRouter.get('/users/:userId', requireRole('analyst'), async (req, res: Response): Promise<void> => {
  const { tenantId } = readTenantFromRequest(req);
  const { userId } = req.params;

  const user = await getUserInTenant(tenantId, userId);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json(user);
});
