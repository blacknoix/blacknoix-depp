import { Router, Response } from 'express';
import { AGENT_UNAUTHORIZED_ERROR, authenticateAgent } from '../middleware/authenticateAgent';
import { recordAgentHeartbeat } from '../services/agentService';
import { AgentAuthenticatedRequest } from '../types/telemetry';

export const agentTrafficRouter = Router();

/**
 * POST /agent/heartbeat
 * Agent-authenticated liveness ping.
 */
agentTrafficRouter.post('/heartbeat', authenticateAgent, async (req, res: Response): Promise<void> => {
  const { agentId, tenantId } = (req as AgentAuthenticatedRequest).agent;

  const ok = await recordAgentHeartbeat(agentId, tenantId);
  if (!ok) {
    res.status(401).json(AGENT_UNAUTHORIZED_ERROR);
    return;
  }

  res.json({ status: 'ok', agentId, tenantId });
});
