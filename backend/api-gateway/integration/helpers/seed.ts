import crypto from 'crypto';
import {
  AgentStatus,
  AlertStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { authTelemetryColumnsForEvent } from '../../src/lib/authTelemetryExtractors';
import { getIntegrationPrisma } from './prisma';

export interface CreateTenantInput {
  id?: string;
  name?: string;
}

export interface CreateUserInput {
  tenantId: string;
  id?: string;
  email?: string;
  role?: Role;
  passwordHash?: string;
}

export interface CreateAgentInput {
  tenantId: string;
  enrolledByUserId: string;
  id?: string;
  status?: AgentStatus;
  lastSeenAt?: Date | null;
  displayName?: string;
  hostname?: string;
  os?: string;
  agentVersion?: string;
  tokenHash?: string;
  tokenPrefix?: string;
  pendingExpiresAt?: Date;
}

export interface CreateTelemetryEventInput {
  tenantId: string;
  agentId: string;
  id?: string;
  eventType?: string;
  severity?: string;
  occurredAt?: Date;
  receivedAt?: Date;
  payload?: Prisma.InputJsonValue;
}

export interface CreateAlertInput {
  tenantId: string;
  agentId: string;
  id?: string;
  title?: string;
  severity?: string;
  status?: AlertStatus;
  createdAt?: Date;
  ruleId?: string | null;
  indicator?: string | null;
  telemetryEventId?: string | null;
}

/** Insert a tenant row. Parent-first seeding step. */
export async function createTenant(input: CreateTenantInput = {}) {
  const prisma = getIntegrationPrisma();
  const id = input.id ?? crypto.randomUUID();
  return prisma.tenant.create({
    data: {
      id,
      name: input.name ?? `tenant-${id.slice(0, 8)}`,
    },
  });
}

/** Insert a user under a tenant. Requires tenantId. */
export async function createUser(input: CreateUserInput) {
  const prisma = getIntegrationPrisma();
  const id = input.id ?? crypto.randomUUID();
  return prisma.user.create({
    data: {
      id,
      tenantId: input.tenantId,
      email: input.email ?? `user-${id}@integration.test`,
      passwordHash: input.passwordHash ?? 'integration-test-hash',
      role: input.role ?? 'admin',
    },
  });
}

/** Insert an agent under a tenant. Requires tenantId and enrolledByUserId. */
export async function createAgent(input: CreateAgentInput) {
  const prisma = getIntegrationPrisma();
  const id = input.id ?? crypto.randomUUID();
  const tokenHash = input.tokenHash ?? crypto.randomBytes(32).toString('hex');
  return prisma.agent.create({
    data: {
      id,
      tenantId: input.tenantId,
      enrolledByUserId: input.enrolledByUserId,
      displayName: input.displayName ?? 'integration-agent',
      hostname: input.hostname ?? 'host-integration',
      os: input.os ?? 'linux',
      agentVersion: input.agentVersion ?? '1.0.0',
      status: input.status ?? 'active',
      tokenHash,
      tokenPrefix: input.tokenPrefix ?? `depp_agt_${tokenHash.slice(0, 9)}`,
      pendingExpiresAt: input.pendingExpiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
      lastSeenAt: input.lastSeenAt ?? null,
    },
  });
}

/** Insert a telemetry event. Requires tenantId and agentId. */
export async function createTelemetryEvent(input: CreateTelemetryEventInput) {
  const prisma = getIntegrationPrisma();
  const id = input.id ?? crypto.randomUUID();
  const occurredAt = input.occurredAt ?? new Date();
  const eventType = input.eventType ?? 'process.start';
  const payload = (input.payload ?? { source: 'integration' }) as Record<string, unknown>;
  const authColumns = authTelemetryColumnsForEvent(eventType, payload);
  return prisma.telemetryEvent.create({
    data: {
      id,
      tenantId: input.tenantId,
      agentId: input.agentId,
      eventType,
      severity: input.severity ?? 'low',
      occurredAt,
      receivedAt: input.receivedAt ?? occurredAt,
      payload: input.payload ?? { source: 'integration' },
      ...authColumns,
    },
  });
}

/** Insert an alert. Requires tenantId and agentId. */
export async function createAlert(input: CreateAlertInput) {
  const prisma = getIntegrationPrisma();
  const id = input.id ?? crypto.randomUUID();
  const now = new Date();
  return prisma.alert.create({
    data: {
      id,
      tenantId: input.tenantId,
      agentId: input.agentId,
      title: input.title ?? 'integration alert',
      severity: input.severity ?? 'low',
      status: input.status ?? 'open',
      createdAt: input.createdAt ?? now,
      updatedAt: input.createdAt ?? now,
      ruleId: input.ruleId ?? null,
      indicator: input.indicator ?? null,
      telemetryEventId: input.telemetryEventId ?? null,
    },
  });
}
