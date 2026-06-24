import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { tenantOwnedWhere } from '../lib/tenantScope';
import { ALERT_TRIGGER_SEVERITIES } from '../types/alert';
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
  };
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
      payload: event.payload,
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
 * Atomically insert events and update agent activity.
 * Used by the ingestion route so both succeed or fail together.
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
  }));

  const triggeringEvents = eventRows.filter((row) =>
    (ALERT_TRIGGER_SEVERITIES as readonly string[]).includes(row.severity)
  );

  await prisma.$transaction(async (tx) => {
    await tx.telemetryEvent.createMany({ data: eventRows });

    await tx.agent.update({
      where: { id: agentId },
      data: {
        status: 'active',
        lastSeenAt: new Date(),
      },
    });

    if (triggeringEvents.length > 0) {
      await tx.alert.createMany({
        data: triggeringEvents.map((row) => ({
          tenantId,
          agentId,
          telemetryEventId: row.id,
          title: `${row.severity.toUpperCase()} event: ${row.eventType}`,
          severity: row.severity,
          status: 'open' as const,
        })),
      });
    }
  });
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
