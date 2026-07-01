import { logAuthEvent } from '../lib/authAudit';
import { recordAgentIsolated, recordAgentRestored } from '../lib/metrics';
import { prisma } from '../lib/prisma';
import { tenantOwnedWhere } from '../lib/tenantScope';
import { AgentStatus } from '../types/agent';
import {
  AgentIsolationError,
  AgentIsolationState,
  IsolationActor,
} from '../types/agentIsolation';

const ISOLATION_SELECT = {
  id: true,
  tenantId: true,
  status: true,
  isolatedAt: true,
} as const;

const TERMINAL_STATUSES: AgentStatus[] = ['revoked', 'expired'];

function toAgentStatus(status: string): AgentStatus {
  const valid: AgentStatus[] = ['pending', 'active', 'inactive', 'revoked', 'expired'];
  return valid.includes(status as AgentStatus) ? (status as AgentStatus) : 'pending';
}

function toIsolationState(row: {
  id: string;
  tenantId: string;
  status: string;
  isolatedAt: Date | null;
}): AgentIsolationState {
  return {
    agentId: row.id,
    tenantId: row.tenantId,
    status: toAgentStatus(row.status),
    isolated: row.isolatedAt !== null,
    isolatedAt: row.isolatedAt ? row.isolatedAt.toISOString() : null,
  };
}

function assertCanChangeIsolation(status: AgentStatus): void {
  if (TERMINAL_STATUSES.includes(status)) {
    throw new AgentIsolationError(
      `Agent cannot be isolated or restored while status is ${status}`,
      'INVALID_STATUS'
    );
  }
}

/**
 * Record platform-side isolation intent for an endpoint agent.
 *
 * v2 TODO: endpoint daemon enforcement (network/process containment) is deferred —
 * this field is the platform record of intent only until the agent acts on it.
 */
export async function isolateAgent(
  tenantId: string,
  agentId: string,
  actor: IsolationActor,
  reason?: string
): Promise<AgentIsolationState | null> {
  const existing = await prisma.agent.findFirst({
    where: tenantOwnedWhere(tenantId, agentId),
    select: ISOLATION_SELECT,
  });

  if (!existing) {
    logAuthEvent({
      action: 'agent_isolation_access_denied',
      outcome: 'denied',
      httpStatus: 404,
      tenantId,
      userId: actor.userId,
      role: actor.role,
      agentId,
      reason: 'not_found',
    });
    return null;
  }

  const status = toAgentStatus(existing.status);
  assertCanChangeIsolation(status);

  if (existing.isolatedAt !== null) {
    logAuthEvent({
      action: 'agent_isolated',
      outcome: 'success',
      tenantId,
      userId: actor.userId,
      role: actor.role,
      agentId,
      reason: reason ?? 'already_isolated',
      meta: { alreadyIsolated: true },
    });
    return toIsolationState(existing);
  }

  const now = new Date();
  const updated = await prisma.agent.update({
    where: { id: agentId },
    data: { isolatedAt: now },
    select: ISOLATION_SELECT,
  });

  logAuthEvent({
    action: 'agent_isolated',
    outcome: 'success',
    tenantId,
    userId: actor.userId,
    role: actor.role,
    agentId,
    reason,
    meta: {
      isolatedAt: now.toISOString(),
      ...(reason ? { operatorReason: reason } : {}),
    },
  });
  recordAgentIsolated();

  return toIsolationState(updated);
}

/** Lift platform-side isolation — first-class reversible counterpart to isolateAgent. */
export async function restoreAgent(
  tenantId: string,
  agentId: string,
  actor: IsolationActor
): Promise<AgentIsolationState | null> {
  const existing = await prisma.agent.findFirst({
    where: tenantOwnedWhere(tenantId, agentId),
    select: ISOLATION_SELECT,
  });

  if (!existing) {
    logAuthEvent({
      action: 'agent_isolation_access_denied',
      outcome: 'denied',
      httpStatus: 404,
      tenantId,
      userId: actor.userId,
      role: actor.role,
      agentId,
      reason: 'not_found',
    });
    return null;
  }

  const status = toAgentStatus(existing.status);
  assertCanChangeIsolation(status);

  if (existing.isolatedAt === null) {
    logAuthEvent({
      action: 'agent_restored',
      outcome: 'success',
      tenantId,
      userId: actor.userId,
      role: actor.role,
      agentId,
      reason: 'not_isolated',
      meta: { alreadyRestored: true },
    });
    return toIsolationState(existing);
  }

  const previousIsolatedAt = existing.isolatedAt.toISOString();
  const updated = await prisma.agent.update({
    where: { id: agentId },
    data: { isolatedAt: null },
    select: ISOLATION_SELECT,
  });

  logAuthEvent({
    action: 'agent_restored',
    outcome: 'success',
    tenantId,
    userId: actor.userId,
    role: actor.role,
    agentId,
    meta: {
      previousIsolatedAt,
    },
  });
  recordAgentRestored();

  return toIsolationState(updated);
}
