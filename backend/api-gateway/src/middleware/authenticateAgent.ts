import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { AgentAuthenticatedRequest } from '../types/telemetry';

const INVALID_TOKEN_ERROR = { error: 'Invalid or expired agent token' };

function hashAgentToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Authenticates a registered agent via Bearer token (SHA-256 hash lookup).
 * Separate from user JWT auth — do not use on /api/* routes.
 */
export async function authenticateAgent(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json(INVALID_TOKEN_ERROR);
    return;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    res.status(401).json(INVALID_TOKEN_ERROR);
    return;
  }

  const tokenHash = hashAgentToken(token);

  const agent = await prisma.agent.findFirst({
    where: { tokenHash },
    select: { id: true, tenantId: true, status: true },
  });

  if (!agent || agent.status === 'revoked') {
    res.status(401).json(INVALID_TOKEN_ERROR);
    return;
  }

  (req as AgentAuthenticatedRequest).agent = {
    agentId: agent.id,
    tenantId: agent.tenantId,
  };

  next();
}
