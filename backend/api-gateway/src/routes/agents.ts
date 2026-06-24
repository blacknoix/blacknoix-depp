import { Router, Response } from 'express';
import { readTenantFromRequest } from '../lib/tenantScope';
import { requireRole } from '../middleware/requireRole';
import { createAgent, getAgentInTenant, listAgentsInTenant } from '../services/agentService';
import { CreateAgentInput } from '../types/agent';

export const agentRouter = Router();

function validateCreateBody(
  body: unknown
): { ok: true; input: CreateAgentInput } | { ok: false; fields: string[] } {
  const data = body as Record<string, unknown>;
  const fields: string[] = [];

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
    hostname: (data.hostname as string).trim(),
    os: (data.os as string).trim(),
    agentVersion: (data.agentVersion as string).trim(),
  };

  if (typeof data.ipAddress === 'string' && data.ipAddress.trim()) {
    input.ipAddress = data.ipAddress.trim();
  }

  return { ok: true, input };
}

/**
 * POST /api/agents
 * Register a new endpoint agent. Returns a one-time agent token.
 */
agentRouter.post('/', requireRole('admin'), async (req, res: Response): Promise<void> => {
  const validated = validateCreateBody(req.body);
  if (!validated.ok) {
    res.status(400).json({ error: 'Validation failed', fields: validated.fields });
    return;
  }

  const { tenantId } = readTenantFromRequest(req);
  const result = await createAgent(tenantId, validated.input);

  res.status(201).json(result);
});

/**
 * GET /api/agents
 * List agents in the caller's tenant.
 */
agentRouter.get('/', requireRole('analyst'), async (req, res: Response): Promise<void> => {
  const { tenantId } = readTenantFromRequest(req);
  const agents = await listAgentsInTenant(tenantId);
  res.json(agents);
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
