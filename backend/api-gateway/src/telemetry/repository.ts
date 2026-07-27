import type { Kysely } from "kysely";

import type { Database } from "../db/schema";
import { withTenantTransaction } from "../db/tenant-context";
import type { TelemetryEventTypeV1 } from "./contract";

export interface TelemetryEventInsert {
  agentId: string;
  schemaVersion: number;
  eventType: TelemetryEventTypeV1;
  occurredAt: Date;
  payload: Record<string, unknown>;
}

export interface TelemetryEventRow {
  id: string;
  tenantId: string;
  agentId: string;
  schemaVersion: number;
  eventType: string;
  occurredAt: Date;
  ingestedAt: Date;
  payload: Record<string, unknown>;
}

export interface TelemetryRepository {
  /**
   * Returns true when the agent exists in the caller's tenant.
   * Cross-tenant agents are invisible under RLS (appear as missing).
   */
  agentExists(tenantId: string, agentId: string): Promise<boolean>;

  insertEvent(
    tenantId: string,
    event: TelemetryEventInsert,
  ): Promise<{ id: string; ingestedAt: Date }>;

  /**
   * Inserts multiple events in a single tenant transaction (all-or-nothing).
   * Empty arrays are rejected by the service before this is called.
   */
  insertEvents(
    tenantId: string,
    events: readonly TelemetryEventInsert[],
  ): Promise<Array<{ id: string; ingestedAt: Date }>>;

  /**
   * Recent events for the tenant, newest ingested first. Cap is enforced
   * server-side (max 100) for safe correlation/test use.
   */
  listRecentByTenant(
    tenantId: string,
    options?: { limit?: number },
  ): Promise<TelemetryEventRow[]>;
}

const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 50;

function asDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    return new Date(value);
  }
  throw new Error("expected a timestamp value");
}

function asPayload(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/**
 * All access runs through withTenantTransaction. tenant_id on inserts is always
 * the argument — never taken from the event contract.
 */
export function createTelemetryRepository(
  db: Kysely<Database>,
): TelemetryRepository {
  async function insertEvents(
    tenantId: string,
    events: readonly TelemetryEventInsert[],
  ): Promise<Array<{ id: string; ingestedAt: Date }>> {
    if (events.length === 0) {
      throw new Error("insertEvents requires at least one event");
    }

    return withTenantTransaction(db, tenantId, async (trx) => {
      const rows = await trx
        .insertInto("telemetry_events")
        .values(
          events.map((event) => ({
            tenant_id: tenantId,
            agent_id: event.agentId,
            schema_version: event.schemaVersion,
            event_type: event.eventType,
            occurred_at: event.occurredAt,
            payload: event.payload,
          })),
        )
        .returning(["id", "ingested_at"])
        .execute();

      return rows.map((row) => ({
        id: row.id,
        ingestedAt: asDate(row.ingested_at),
      }));
    });
  }

  return {
    async agentExists(tenantId, agentId) {
      return withTenantTransaction(db, tenantId, async (trx) => {
        const row = await trx
          .selectFrom("agents")
          .select("id")
          .where("id", "=", agentId)
          .executeTakeFirst();

        return row !== undefined;
      });
    },

    async insertEvent(tenantId, event) {
      const [row] = await insertEvents(tenantId, [event]);
      return row;
    },

    insertEvents,

    async listRecentByTenant(tenantId, options = {}) {
      const limit = Math.min(
        Math.max(1, options.limit ?? DEFAULT_LIST_LIMIT),
        MAX_LIST_LIMIT,
      );

      return withTenantTransaction(db, tenantId, async (trx) => {
        const rows = await trx
          .selectFrom("telemetry_events")
          .selectAll()
          .orderBy("ingested_at", "desc")
          .limit(limit)
          .execute();

        return rows.map((row) => ({
          id: row.id,
          tenantId: row.tenant_id,
          agentId: row.agent_id,
          schemaVersion: row.schema_version,
          eventType: row.event_type,
          occurredAt: asDate(row.occurred_at),
          ingestedAt: asDate(row.ingested_at),
          payload: asPayload(row.payload),
        }));
      });
    },
  };
}
