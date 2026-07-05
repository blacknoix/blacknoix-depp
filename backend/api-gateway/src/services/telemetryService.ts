import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { authTelemetryColumnsForEvent } from '../lib/authTelemetryExtractors';
import { evaluateRules } from '../lib/correlationEngine';
import { logAuthEvent } from '../lib/authAudit';
import { prisma } from '../lib/prisma';
import { recordAlertCreated } from '../lib/metrics';
import { tenantOwnedWhere, tenantWhere } from '../lib/tenantScope';
import { AuthTelemetryQueryParams } from '../types/authTelemetry';
import { TelemetryEventInput, TelemetryEventRecord } from '../types/telemetry';

const EVENT_SELECT = {
  id: true,
  tenantId: true,
  agentId: true,
  eventType: true,
  severity: true,
  occurredAt: true,
  receivedAt: true,
  payload: true,
  authAccount: true,
  authHost: true,
  authGrantedTo: true,
  authSourceHost: true,
} as const;

function toEventRecord(row: {
  id: string;
  tenantId: string;
  agentId: string;
  eventType: string;
  severity: string;
  occurredAt: Date;
  receivedAt: Date;
  payload: unknown;
  authAccount: string | null;
  authHost: string | null;
  authGrantedTo: string | null;
  authSourceHost: string | null;
}): TelemetryEventRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    agentId: row.agentId,
    eventType: row.eventType,
    severity: row.severity,
    occurredAt: row.occurredAt,
    receivedAt: row.receivedAt,
    payload: row.payload as Record<string, unknown>,
    authAccount: row.authAccount,
    authHost: row.authHost,
    authGrantedTo: row.authGrantedTo,
    authSourceHost: row.authSourceHost,
  };
}

function authColumnsFromInput(event: TelemetryEventInput) {
  return authTelemetryColumnsForEvent(event.eventType, event.payload);
}

/** Persist telemetry events for an authenticated agent. */
export async function insertEvents(
  agentId: string,
  tenantId: string,
  events: TelemetryEventInput[]
): Promise<void> {
  await prisma.telemetryEvent.createMany({
    data: events.map((event) => ({
      id: crypto.randomUUID(),
      tenantId,
      agentId,
      eventType: event.eventType,
      severity: event.severity,
      occurredAt: new Date(event.occurredAt),
      payload: event.payload as Prisma.InputJsonValue,
      ...authColumnsFromInput(event),
    })),
  });
}

/** Mark agent as active and update last-seen timestamp. */
export async function updateAgentActivity(agentId: string): Promise<void> {
  await prisma.agent.update({
    where: { id: agentId },
    data: {
      status: 'active',
      lastSeenAt: new Date(),
    },
  });
}

/**
 * Atomically insert events, correlate alerts, and update agent activity.
 * Correlation runs before the transaction (pure evaluateRules); persistence is transactional.
 */
export async function ingestTelemetryBatch(
  agentId: string,
  tenantId: string,
  events: TelemetryEventInput[]
): Promise<void> {
  const eventRows = events.map((event) => ({
    id: crypto.randomUUID(),
    tenantId,
    agentId,
    eventType: event.eventType,
    severity: event.severity,
    occurredAt: new Date(event.occurredAt),
    payload: event.payload,
    ...authColumnsFromInput(event),
  }));

  const alertsToCreate = evaluateRules(eventRows, { agentId, tenantId });

  await prisma.$transaction(async (tx) => {
    await tx.telemetryEvent.createMany({
      data: eventRows.map((row) => ({
        ...row,
        payload: row.payload as Prisma.InputJsonValue,
      })),
    });

    await tx.agent.update({
      where: { id: agentId },
      data: {
        status: 'active',
        lastSeenAt: new Date(),
      },
    });

    if (alertsToCreate.length > 0) {
      await tx.alert.createMany({
        data: alertsToCreate.map((alert) => ({
          tenantId: alert.tenantId,
          agentId: alert.agentId,
          telemetryEventId: alert.telemetryEventId ?? null,
          title: alert.title,
          severity: alert.severity,
          ruleId: alert.ruleId,
          indicator: alert.indicator,
          status: 'open' as const,
        })),
      });
    }
  });

  if (alertsToCreate.length > 0) {
    const ruleIds = [...new Set(alertsToCreate.map((a) => a.ruleId))].join(',');
    logAuthEvent({
      action: 'alert_created',
      outcome: 'success',
      tenantId,
      agentId,
      meta: {
        alertCount: alertsToCreate.length,
        ruleIds,
      },
    });
    for (let i = 0; i < alertsToCreate.length; i += 1) {
      recordAlertCreated();
    }
  }
}

/**
 * List telemetry events for an agent scoped to a tenant.
 * Returns null when the agent does not belong to the tenant.
 */
export async function listEventsForAgent(
  tenantId: string,
  agentId: string,
  limit: number,
  before?: Date
): Promise<TelemetryEventRecord[] | null> {
  const agent = await prisma.agent.findFirst({
    where: tenantOwnedWhere(tenantId, agentId),
    select: { id: true },
  });

  if (!agent) {
    return null;
  }

  const events = await prisma.telemetryEvent.findMany({
    where: {
      tenantId,
      agentId,
      ...(before ? { receivedAt: { lt: before } } : {}),
    },
    orderBy: { receivedAt: 'desc' },
    take: limit,
    select: EVENT_SELECT,
  });

  return events.map(toEventRecord);
}

/**
 * List tenant-scoped auth telemetry events for correlation queries.
 * Filters on structured columns (authAccount, eventType) and occurredAt window.
 */
export async function listAuthTelemetryForTenant(
  tenantId: string,
  filters: AuthTelemetryQueryParams
): Promise<TelemetryEventRecord[]> {
  const events = await prisma.telemetryEvent.findMany({
    where: {
      ...tenantWhere(tenantId),
      authAccount: { not: null },
      ...(filters.eventType ? { eventType: filters.eventType } : {}),
      ...(filters.authAccount ? { authAccount: filters.authAccount } : {}),
      ...(filters.since || filters.until
        ? {
            occurredAt: {
              ...(filters.since ? { gte: filters.since } : {}),
              ...(filters.until ? { lte: filters.until } : {}),
            },
          }
        : {}),
    },
    orderBy: { occurredAt: 'asc' },
    take: filters.limit,
    select: EVENT_SELECT,
  });

  return events.map(toEventRecord);
}
