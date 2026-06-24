import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { tenantOwnedWhere, tenantWhere, withTenantId } from '../lib/tenantScope';
import {
  AgentDetail,
  AgentStatus,
  AgentSummary,
  CreateAgentInput,
} from '../types/agent';

const AGENT_SUMMARY_SELECT = {
  id: true,
  tenantId: true,
  hostname: true,
  os: true,
  agentVersion: true,
  status: true,
  registeredAt: true,
} as const;

function hashAgentToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function toAgentStatus(status: string): AgentStatus {
  const valid: AgentStatus[] = ['pending', 'active', 'inactive', 'revoked'];
  return valid.includes(status as AgentStatus) ? (status as AgentStatus) : 'pending';
}

function toAgentSummary(row: {
  id: string;
  tenantId: string;
  hostname: string;
  os: string;
  agentVersion: string;
  status: string | AgentStatus;
  registeredAt: Date;
}): AgentSummary {
  return {
    id: row.id,
    tenantId: row.tenantId,
    hostname: row.hostname,
    os: row.os,
    agentVersion: row.agentVersion,
    status: toAgentStatus(row.status),
    registeredAt: row.registeredAt,
  };
}

/**
 * Register a new agent under a tenant and return a one-time plaintext token.
 * The token is hashed with SHA-256 before persistence; it is never stored or logged.
 */
export async function createAgent(
  tenantId: string,
  input: CreateAgentInput
): Promise<{ agent: AgentSummary; agentToken: string }> {
  const agentToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashAgentToken(agentToken);

  const agent = await prisma.agent.create({
    data: withTenantId(tenantId, {
      hostname: input.hostname,
      os: input.os,
      agentVersion: input.agentVersion,
      ipAddress: input.ipAddress ?? null,
      tokenHash,
    }),
    select: AGENT_SUMMARY_SELECT,
  });

  return { agent: toAgentSummary(agent), agentToken };
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
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}
