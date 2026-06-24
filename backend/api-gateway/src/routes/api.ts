import { Router, Response } from 'express';
import { tenantScoped } from '../middleware/tenantScoped';
import { requireMatchingTenantParam } from '../middleware/requireMatchingTenantParam';
import { requireRole } from '../middleware/requireRole';
import { readTenantFromRequest } from '../lib/tenantScope';
import { getTenantProfile } from '../services/tenantService';
import { getUserInTenant } from '../services/userService';
import { listEventsForAgent } from '../services/telemetryService';
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
 * GET /api/agents/:agentId/events
 * List telemetry events for an agent in the caller's tenant.
 */
apiRouter.get(
  '/agents/:agentId/events',
  requireRole('analyst'),
  async (req, res: Response): Promise<void> => {
    const { tenantId } = readTenantFromRequest(req);
    const { agentId } = req.params;

    const limitRaw = req.query.limit;
    let limit = 50;
    if (typeof limitRaw === 'string') {
      const parsed = parseInt(limitRaw, 10);
      if (!Number.isNaN(parsed)) {
        limit = Math.min(Math.max(parsed, 1), 200);
      }
    }

    let before: Date | undefined;
    const beforeRaw = req.query.before;
    if (typeof beforeRaw === 'string') {
      const parsed = new Date(beforeRaw);
      if (!Number.isNaN(parsed.getTime())) {
        before = parsed;
      }
    }

    const events = await listEventsForAgent(tenantId, agentId, limit, before);
    if (events === null) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    res.json(events);
  }
);

/**
 * GET /api/tenant
 * Returns the authenticated caller's tenant profile.
 */
apiRouter.get('/tenant', async (req, res: Response): Promise<void> => {
  const { tenantId } = readTenantFromRequest(req);

  const tenant = await getTenantProfile(tenantId);
  if (!tenant) {
    res.status(404).json({ error: 'Tenant not found' });
    return;
  }

  res.json(tenant);
});

/**
 * GET /api/tenants/:tenantId
 * Example of an explicit tenant param route — param must match the token.
 */
apiRouter.get(
  '/tenants/:tenantId',
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
apiRouter.get('/users/:userId', async (req, res: Response): Promise<void> => {
  const { tenantId } = readTenantFromRequest(req);
  const { userId } = req.params;

  const user = await getUserInTenant(tenantId, userId);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json(user);
});
