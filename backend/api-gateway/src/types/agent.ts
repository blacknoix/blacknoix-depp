export type AgentStatus = 'pending' | 'active' | 'inactive' | 'revoked' | 'expired';

export interface EnrollAgentActor {
  userId: string;
  role: string;
}

export interface CreateAgentInput {
  displayName: string;
  hostname: string;
  os: string;
  agentVersion: string;
  enrollmentWindowHours?: number;
  ipAddress?: string;
}

export interface AgentSummary {
  id: string;
  tenantId: string;
  displayName: string;
  hostname: string;
  os: string;
  agentVersion: string;
  status: AgentStatus;
  tokenPrefix: string;
  enrolledBy: string;
  pendingExpiresAt: Date;
  registeredAt: Date;
}

export interface AgentDetail extends AgentSummary {
  ipAddress: string | null;
  lastSeenAt: Date | null;
  lastAgentVersion: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentEnrollmentResult {
  agent: AgentSummary;
  /** One-time enrollment token — never stored server-side. */
  enrollmentToken: string;
  _tokenWarning: string;
}

export const ENROLLMENT_TOKEN_WARNING =
  'This token will not be shown again. Store it securely before closing this response.';

export const DEFAULT_ENROLLMENT_WINDOW_HOURS = 24;
export const MAX_ENROLLMENT_WINDOW_HOURS = 72;
