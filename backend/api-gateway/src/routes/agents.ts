import { Router, Response } from 'express';
import { readTenantFromRequest } from '../lib/tenantScope';
import { requireRole } from '../middleware/requireRole';
import {
  createAgentEnrollment,
  getAgentInTenant,
  listAgentsInTenant,
  revokeAgent,
} from '../services/agentService';
import { isolateAgent, restoreAgent } from '../services/agentIsolationService';
import { listEventsForAgent } from '../services/telemetryService';
import {
  CreateAgentInput,
  DEFAULT_ENROLLMENT_WINDOW_HOURS,
  MAX_ENROLLMENT_WINDOW_HOURS,
} from '../types/agent';
import { AgentIsolationError } from '../types/agentIsolation';

export const agentRouter = Router();

function validateCreateBody(
  body: unknown
): { ok: true; input: CreateAgentInput } | { ok: false; fields: string[] } {
  const data = body as Record<string, unknown>;
  const fields: string[] = [];

  if (typeof data.displayName !== 'string' || !data.displayName.trim()) {
    fields.push('displayName');
  }
  if (typeof data.hostname !== 'string' || !data.hostname.trim()) {
    fields.push('hostname');
  }
  if (typeof data.os !== 'string' || !data.os.trim()) {
    fields.push('os');
  }
  if (typeof data.agentVersion !== 'string' || !data.agentVersion.trim()) {
    fields.push('agentVersion');
  }

  if (fields.length > 0) {
    return { ok: false, fields };
  }

  const input: CreateAgentInput = {
    displayName: (data.displayName as string).trim(),
    hostname: (data.hostname as string).trim(),
    os: (data.os as string).trim(),
    agentVersion: (data.agentVersion as string).trim(),
  };

  if (typeof data.enrollmentWindowHours === 'number') {
    input.enrollmentWindowHours = Math.min(
      Math.max(Math.floor(data.enrollmentWindowHours), 1),
      MAX_ENROLLMENT_WINDOW_HOURS
    );
  } else if (typeof data.enrollmentWindowHours === 'string') {
    const parsed = parseInt(data.enrollmentWindowHours, 10);
    if (!Number.isNaN(parsed)) {
      input.enrollmentWindowHours = Math.min(
        Math.max(parsed, 1),
        MAX_ENROLLMENT_WINDOW_HOURS
      );
    }
  }

  if (typeof data.ipAddress === 'string' && data.ipAddress.trim()) {
    input.ipAddress = data.ipAddress.trim();
  }

  return { ok: true, input };
}

function readActor(req: Parameters<typeof readTenantFromRequest>[0]) {
  const { tenantId, userId, role } = readTenantFromRequest(req);
  return { tenantId, actor: { userId, role } };
}

function enrollmentHandler(req: Parameters<typeof readTenantFromRequest>[0], res: Response): Promise<void> {
  const validated = validateCreateBody(req.body);
  if (!validated.ok) {
    res.status(400).json({ error: 'Validation failed', fields: validated.fields });
    return Promise.resolve();
  }

  const { tenantId, actor } = readActor(req);
  return createAgentEnrollment(tenantId, validated.input, actor).then((result) => {
    res.status(201).json(result);
  });
}

/**
 * POST /api/agents/enroll
 * Enroll a new endpoint agent. Returns a one-time enrollment token.
 */
agentRouter.post('/enroll', requireRole('admin'), (req, res) => enrollmentHandler(req, res));

/**
 * POST /api/agents
 * Primary enrollment endpoint (architecture alias).
 */
agentRouter.post('/', requireRole('admin'), (req, res) => enrollmentHandler(req, res));

/**
 * GET /api/agents
 * List agents in the caller's tenant.
 */
agentRouter.get('/', requireRole('analyst'), async (req, res: Response): Promise<void> => {
  const { tenantId } = readTenantFromRequest(req);
  const agents = await listAgentsInTenant(tenantId);
  res.json(agents);
});

async function revokeHandler(req: Parameters<typeof readTenantFromRequest>[0], res: Response): Promise<void> {
  const { tenantId, actor } = readActor(req);
  const body = req.body as Record<string, unknown>;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : undefined;

  const agent = await revokeAgent(tenantId, req.params.agentId, actor, reason);

  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  res.json({ status: 'revoked', agent });
}

/**
 * POST /api/agents/:agentId/revoke
 * Revoke an agent credential in the caller's tenant.
 */
agentRouter.post('/:agentId/revoke', requireRole('admin'), (req, res) => revokeHandler(req, res));

/**
 * PATCH /api/agents/:agentId/revoke
 * Architecture alias for revocation.
 */
agentRouter.patch('/:agentId/revoke', requireRole('admin'), (req, res) => revokeHandler(req, res));

function readOptionalReason(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }
  const reason = (body as Record<string, unknown>).reason;
  return typeof reason === 'string' ? reason.trim() : undefined;
}

function isValidAgentId(agentId: string): boolean {
  return typeof agentId === 'string' && agentId.trim().length > 0;
}

async function isolateHandler(req: Parameters<typeof readTenantFromRequest>[0], res: Response): Promise<void> {
  const { agentId } = req.params;
  if (!isValidAgentId(agentId)) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  const { tenantId, actor } = readActor(req);
  const reason = readOptionalReason(req.body);

  try {
    const isolation = await isolateAgent(tenantId, agentId, actor, reason);
    if (!isolation) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    res.json(isolation);
  } catch (error) {
    if (error instanceof AgentIsolationError) {
      res.status(409).json({ error: error.message });
      return;
    }
    throw error;
  }
}

async function restoreHandler(req: Parameters<typeof readTenantFromRequest>[0], res: Response): Promise<void> {
  const { agentId } = req.params;
  if (!isValidAgentId(agentId)) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  const { tenantId, actor } = readActor(req);

  try {
    const isolation = await restoreAgent(tenantId, agentId, actor);
    if (!isolation) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    res.json(isolation);
  } catch (error) {
    if (error instanceof AgentIsolationError) {
      res.status(409).json({ error: error.message });
      return;
    }
    throw error;
  }
}

/**
 * POST /api/agents/:agentId/isolate
 * Record platform-side isolation intent for an endpoint agent.
 */
agentRouter.post('/:agentId/isolate', requireRole('admin'), (req, res) => isolateHandler(req, res));

/**
 * POST /api/agents/:agentId/restore
 * Lift platform-side isolation for an endpoint agent.
 */
agentRouter.post('/:agentId/restore', requireRole('admin'), (req, res) => restoreHandler(req, res));

/**
 * GET /api/agents/:agentId/events
 * List telemetry events for an agent in the caller's tenant.
 */
agentRouter.get('/:agentId/events', requireRole('analyst'), async (req, res: Response): Promise<void> => {
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
});

/**
 * GET /api/agents/:agentId
 * Get a single agent in the caller's tenant.
 */
agentRouter.get('/:agentId', requireRole('analyst'), async (req, res: Response): Promise<void> => {
  const { tenantId } = readTenantFromRequest(req);
  const agent = await getAgentInTenant(tenantId, req.params.agentId);

  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  res.json(agent);
});

export { DEFAULT_ENROLLMENT_WINDOW_HOURS };
