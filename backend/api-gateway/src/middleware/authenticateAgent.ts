import { Request, Response, NextFunction } from 'express';
import { parseAgentBearerToken } from '../lib/agentToken';
import { hashClientIp, logAuthEvent } from '../lib/authAudit';
import { recordAgentAuthFailure, recordAgentAuthSuccess } from '../lib/metrics';
import {
  applyAgentAuthSideEffects,
  authenticateAgentCredential,
} from '../services/agentService';
import { AgentAuthenticatedRequest } from '../types/telemetry';

export const AGENT_UNAUTHORIZED_ERROR = { error: 'Unauthorized' };

/**
 * Authenticates a registered agent via Bearer enrollment token.
 * Separate from user JWT auth — do not use on /api/* routes.
 *
 * Format: Authorization: Bearer depp_agt_<64-hex-chars>
 */
export async function authenticateAgent(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const rawToken = parseAgentBearerToken(req);
  if (!rawToken) {
    logAuthEvent({
      action: 'agent_auth_failed',
      outcome: 'failure',
      httpStatus: 401,
      route: req.path,
      method: req.method,
      reason: 'missing_credentials',
      clientIpHash: hashClientIp(req),
    });
    recordAgentAuthFailure();
    res.status(401).json(AGENT_UNAUTHORIZED_ERROR);
    return;
  }

  const context = await authenticateAgentCredential(rawToken);
  if (!context) {
    logAuthEvent({
      action: 'agent_auth_failed',
      outcome: 'failure',
      httpStatus: 401,
      route: req.path,
      method: req.method,
      reason: 'invalid_token',
      clientIpHash: hashClientIp(req),
    });
    recordAgentAuthFailure();
    res.status(401).json(AGENT_UNAUTHORIZED_ERROR);
    return;
  }

  logAuthEvent({
    action: 'agent_auth_success',
    outcome: 'success',
    route: req.path,
    method: req.method,
    agentId: context.agentId,
    tenantId: context.tenantId,
    clientIpHash: hashClientIp(req),
  });
  recordAgentAuthSuccess();

  applyAgentAuthSideEffects(context, req);

  (req as AgentAuthenticatedRequest).agent = {
    agentId: context.agentId,
    tenantId: context.tenantId,
  };
  next();
}
