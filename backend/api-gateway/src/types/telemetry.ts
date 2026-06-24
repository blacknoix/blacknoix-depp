import { Request } from 'express';

export const VALID_SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;

export type SeverityLevel = (typeof VALID_SEVERITIES)[number];

export interface AgentContext {
  agentId: string;
  tenantId: string;
}

export interface TelemetryEventInput {
  eventType: string;
  severity: SeverityLevel;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export interface TelemetryEventRecord {
  id: string;
  tenantId: string;
  agentId: string;
  eventType: string;
  severity: string;
  occurredAt: Date;
  receivedAt: Date;
  payload: Record<string, unknown>;
}

/** Express Request augmented after authenticateAgent middleware runs. */
export interface AgentAuthenticatedRequest extends Request {
  agent: AgentContext;
}
