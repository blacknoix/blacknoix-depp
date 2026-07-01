import { AgentStatus } from './agent';
import { EnrollAgentActor } from './agent';

export interface IsolateAgentRequest {
  reason?: string;
}

export interface AgentIsolationState {
  agentId: string;
  tenantId: string;
  status: AgentStatus;
  isolated: boolean;
  isolatedAt: string | null;
}

export type IsolationActor = EnrollAgentActor;

export class AgentIsolationError extends Error {
  constructor(
    message: string,
    readonly code: 'INVALID_STATUS'
  ) {
    super(message);
    this.name = 'AgentIsolationError';
  }
}
