import crypto, { timingSafeEqual } from 'crypto';
import { generateRawAgentToken, tokenPrefixFromRaw } from '../lib/agentToken';
import { hashAgentClientIp, logAuthEvent } from '../lib/authAudit';
import {
  recordAgentActivated,
  recordAgentEnrollmentFailure,
  recordAgentEnrollmentSuccess,
  recordAgentExpired,
  recordAgentRevoked,
} from '../lib/metrics';
import { prisma } from '../lib/prisma';
import { tenantOwnedWhere, tenantWhere, withTenantId } from '../lib/tenantScope';
import { env } from '../config/env';
import {
  AgentDetail,
  AgentEnrollmentResult,
  AgentStatus,
  AgentSummary,
  CreateAgentInput,
  DEFAULT_ENROLLMENT_WINDOW_HOURS,
  ENROLLMENT_TOKEN_WARNING,
  EnrollAgentActor,
  MAX_ENROLLMENT_WINDOW_HOURS,
} from '../types/agent';
import { Request } from 'express';

const AGENT_SUMMARY_SELECT = {
  id: true,
  tenantId: true,
  displayName: true,
  hostname: true,
  os: true,
  agentVersion: true,
  status: true,
  tokenPrefix: true,
  enrolledByUserId: true,
  pendingExpiresAt: true,
  registeredAt: true,
  isolatedAt: true,
} as const;

const MAX_TOKEN_CREATE_ATTEMPTS = 3;

export function hashAgentToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function verifyAgentToken(providedToken: string, storedHash: string): boolean {
  const providedHash = hashAgentToken(providedToken);
  const a = Buffer.from(providedHash, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'P2002'
  );
}

function toAgentStatus(status: string): AgentStatus {
  const valid: AgentStatus[] = ['pending', 'active', 'inactive', 'revoked', 'expired'];
  return valid.includes(status as AgentStatus) ? (status as AgentStatus) : 'pending';
}

function resolveEnrollmentWindowHours(hours?: number): number {
  if (hours === undefined) {
    return DEFAULT_ENROLLMENT_WINDOW_HOURS;
  }
  return Math.min(Math.max(Math.floor(hours), 1), MAX_ENROLLMENT_WINDOW_HOURS);
}

function toAgentSummary(row: {
  id: string;
  tenantId: string;
  displayName: string;
  hostname: string;
  os: string;
  agentVersion: string;
  status: string | AgentStatus;
  tokenPrefix: string;
  enrolledByUserId: string;
  pendingExpiresAt: Date;
  registeredAt: Date;
  isolatedAt?: Date | null;
}): AgentSummary {
  return {
    id: row.id,
    tenantId: row.tenantId,
    displayName: row.displayName,
    hostname: row.hostname,
    os: row.os,
    agentVersion: row.agentVersion,
    status: toAgentStatus(row.status),
    tokenPrefix: row.tokenPrefix,
    enrolledBy: row.enrolledByUserId,
    pendingExpiresAt: row.pendingExpiresAt,
    registeredAt: row.registeredAt,
    isolatedAt: row.isolatedAt ?? null,
  };
}

export interface AuthenticatedAgentContext {
  agentId: string;
  tenantId: string;
  status: AgentStatus;
  tokenPrefix: string;
}

/**
 * Enroll a new agent under a tenant. Returns a one-time Bearer enrollment token.
 * Only the SHA-256 hash of the token is persisted.
 */
export async function createAgentEnrollment(
  tenantId: string,
  input: CreateAgentInput,
  actor: EnrollAgentActor
): Promise<AgentEnrollmentResult> {
  const enrollmentWindowHours = resolveEnrollmentWindowHours(input.enrollmentWindowHours);
  const pendingExpiresAt = new Date(Date.now() + enrollmentWindowHours * 60 * 60 * 1000);

  for (let attempt = 0; attempt < MAX_TOKEN_CREATE_ATTEMPTS; attempt += 1) {
    const enrollmentToken = generateRawAgentToken();
    const tokenHash = hashAgentToken(enrollmentToken);
    const tokenPrefix = tokenPrefixFromRaw(enrollmentToken);

    try {
      const agent = await prisma.agent.create({
        data: withTenantId(tenantId, {
          displayName: input.displayName,
          hostname: input.hostname,
          os: input.os,
          agentVersion: input.agentVersion,
          ipAddress: input.ipAddress ?? null,
          tokenHash,
          tokenPrefix,
          enrolledByUserId: actor.userId,
          pendingExpiresAt,
        }),
        select: AGENT_SUMMARY_SELECT,
      });

      logAuthEvent({
        action: 'agent_enrollment',
        outcome: 'success',
        tenantId,
        userId: actor.userId,
        agentId: agent.id,
        role: actor.role,
      });
      recordAgentEnrollmentSuccess();

      return {
        agent: toAgentSummary(agent),
        enrollmentToken,
        _tokenWarning: ENROLLMENT_TOKEN_WARNING,
      };
    } catch (error) {
      if (isUniqueConstraintError(error) && attempt < MAX_TOKEN_CREATE_ATTEMPTS - 1) {
        continue;
      }

      logAuthEvent({
        action: 'agent_enrollment_failed',
        outcome: 'failure',
        tenantId,
        userId: actor.userId,
        role: actor.role,
        reason: 'persistence_error',
      });
      recordAgentEnrollmentFailure();
      throw new Error('Failed to enroll agent');
    }
  }

  throw new Error('Failed to enroll agent');
}

/** Mark a pending agent as expired when its enrollment window has passed. */
export async function expirePendingAgent(agentId: string, tenantId: string): Promise<void> {
  await prisma.agent.updateMany({
    where: { id: agentId, tenantId, status: 'pending' },
    data: { status: 'expired' },
  });

  logAuthEvent({
    action: 'agent_expired',
    outcome: 'success',
    agentId,
    tenantId,
  });
  recordAgentExpired();
}

/**
 * Verify agent Bearer token and return bound tenant/agent context.
 * Returns null for unknown, revoked, expired, or invalid tokens.
 */
export async function authenticateAgentCredential(
  rawToken: string
): Promise<AuthenticatedAgentContext | null> {
  const tokenHash = hashAgentToken(rawToken);

  const agent = await prisma.agent.findFirst({
    where: { tokenHash },
    select: {
      id: true,
      tenantId: true,
      status: true,
      tokenHash: true,
      tokenPrefix: true,
      pendingExpiresAt: true,
    },
  });

  if (!agent) {
    return null;
  }

  if (agent.status === 'revoked' || agent.status === 'expired') {
    return null;
  }

  if (!verifyAgentToken(rawToken, agent.tokenHash)) {
    return null;
  }

  if (agent.status === 'pending' && agent.pendingExpiresAt < new Date()) {
    await expirePendingAgent(agent.id, agent.tenantId);
    return null;
  }

  return {
    agentId: agent.id,
    tenantId: agent.tenantId,
    status: toAgentStatus(agent.status),
    tokenPrefix: agent.tokenPrefix,
  };
}

/** Apply post-auth side effects without blocking the response. */
export function applyAgentAuthSideEffects(
  context: AuthenticatedAgentContext,
  req: Pick<Request, 'ip' | 'socket'>
): void {
  const ipHash = hashAgentClientIp(req, env.ipHashSalt);
  const now = new Date();

  void (async () => {
    if (context.status === 'pending') {
      await prisma.agent.update({
        where: { id: context.agentId },
        data: {
          status: 'active',
          lastSeenAt: now,
          ...(ipHash ? { lastIpHash: ipHash } : {}),
        },
      });

      logAuthEvent({
        action: 'agent_activated',
        outcome: 'success',
        agentId: context.agentId,
        tenantId: context.tenantId,
        clientIpHash: ipHash?.slice(0, 16),
      });
      recordAgentActivated();
      return;
    }

    if (context.status === 'active' || context.status === 'inactive') {
      await prisma.agent.update({
        where: { id: context.agentId },
        data: {
          lastSeenAt: now,
          ...(ipHash ? { lastIpHash: ipHash } : {}),
        },
      });
    }
  })().catch(() => {
    // Side effects must not affect the authenticated response path.
  });
}

/** Revoke an agent in the caller's tenant. Returns null when not found cross-tenant. */
export async function revokeAgent(
  tenantId: string,
  agentId: string,
  actor: EnrollAgentActor,
  reason?: string
): Promise<AgentSummary | null> {
  const existing = await prisma.agent.findFirst({
    where: tenantOwnedWhere(tenantId, agentId),
    select: AGENT_SUMMARY_SELECT,
  });

  if (!existing) {
    logAuthEvent({
      action: 'agent_revoked',
      outcome: 'failure',
      tenantId,
      userId: actor.userId,
      agentId,
      role: actor.role,
      reason: 'not_found',
    });
    return null;
  }

  if (existing.status === 'revoked') {
    logAuthEvent({
      action: 'agent_revoked',
      outcome: 'success',
      tenantId,
      userId: actor.userId,
      agentId,
      role: actor.role,
      reason: reason ?? 'already_revoked',
    });
    return toAgentSummary(existing);
  }

  const agent = await prisma.agent.update({
    where: { id: agentId },
    data: { status: 'revoked' },
    select: AGENT_SUMMARY_SELECT,
  });

  logAuthEvent({
    action: 'agent_revoked',
    outcome: 'success',
    tenantId,
    userId: actor.userId,
    agentId,
    role: actor.role,
    reason,
  });
  recordAgentRevoked();

  return toAgentSummary(agent);
}

/** @deprecated Use createAgentEnrollment */
export async function createAgent(
  tenantId: string,
  input: CreateAgentInput
): Promise<{ agent: AgentSummary; agentToken: string; enrollmentToken: string }> {
  const result = await createAgentEnrollment(tenantId, input, {
    userId: 'legacy',
    role: 'admin',
  });
  return {
    agent: result.agent,
    agentToken: result.enrollmentToken,
    enrollmentToken: result.enrollmentToken,
  };
}

/** List all agents belonging to a tenant, newest first. */
export async function listAgentsInTenant(tenantId: string): Promise<AgentSummary[]> {
  const agents = await prisma.agent.findMany({
    where: tenantWhere(tenantId),
    orderBy: { registeredAt: 'desc' },
    select: AGENT_SUMMARY_SELECT,
  });

  return agents.map(toAgentSummary);
}

/**
 * Fetch a single agent scoped to a tenant.
 * Returns null for cross-tenant ids (map to 404 at the route layer).
 */
export async function getAgentInTenant(
  tenantId: string,
  agentId: string
): Promise<AgentDetail | null> {
  const agent = await prisma.agent.findFirst({
    where: tenantOwnedWhere(tenantId, agentId),
    select: {
      ...AGENT_SUMMARY_SELECT,
      ipAddress: true,
      lastSeenAt: true,
      lastAgentVersion: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!agent) {
    return null;
  }

  return {
    ...toAgentSummary(agent),
    ipAddress: agent.ipAddress,
    lastSeenAt: agent.lastSeenAt,
    lastAgentVersion: agent.lastAgentVersion,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

/** Record agent heartbeat — marks active and updates lastSeenAt. */
export async function recordAgentHeartbeat(agentId: string, tenantId: string): Promise<boolean> {
  const agent = await prisma.agent.findFirst({
    where: tenantOwnedWhere(tenantId, agentId),
    select: { id: true, status: true },
  });

  if (!agent || agent.status === 'revoked' || agent.status === 'expired') {
    return false;
  }

  await prisma.agent.update({
    where: { id: agentId },
    data: {
      status: 'active',
      lastSeenAt: new Date(),
    },
  });

  return true;
}

/** @deprecated Use hashAgentToken */
export const hashAgentSecret = hashAgentToken;
