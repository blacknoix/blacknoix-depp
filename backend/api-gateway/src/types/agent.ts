export type AgentStatus = 'pending' | 'active' | 'inactive' | 'revoked';

export interface CreateAgentInput {
  hostname: string;
  os: string;
  agentVersion: string;
  ipAddress?: string;
}

export interface AgentSummary {
  id: string;
  tenantId: string;
  hostname: string;
  os: string;
  agentVersion: string;
  status: AgentStatus;
  registeredAt: Date;
}

export interface AgentDetail extends AgentSummary {
  ipAddress: string | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
