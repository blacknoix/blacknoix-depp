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

  const heartbeat = await recordAgentHeartbeat(agentId, tenantId);
  if (heartbeat === null) {
    res.status(401).json(AGENT_UNAUTHORIZED_ERROR);
    return;
  }

  res.json({
    status: 'ok',
    agentId,
    tenantId,
    isolated: heartbeat.isolated,
    isolatedAt: heartbeat.isolatedAt,
  });
});
