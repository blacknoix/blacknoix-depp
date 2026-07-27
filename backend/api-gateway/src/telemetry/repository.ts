import type { Kysely, Transaction } from "kysely";
import { sql } from "kysely";

import type { Database } from "../db/schema";
import { withTenantTransaction } from "../db/tenant-context";
import type { TelemetryEventTypeV1 } from "./contract";
import type { TelemetryQueryV1 } from "./query";

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

export interface TelemetryAgentSummary {
  agentId: string;
  lastSeenAt: Date | null;
  lastHeartbeatAt: Date | null;
  countsByEventType: Record<string, number>;
  totalInWindow: number;
}

export interface TelemetryQueryResult {
  events: TelemetryEventRow[];
  summary: TelemetryAgentSummary;
}

/** Index-friendly window aggregate for correlation rules. */
export interface TelemetryWindowSummary {
  countsByType: Record<string, number>;
  total: number;
  oldestOccurredAt: Date | null;
  newestOccurredAt: Date | null;
  sampleEventIds: string[];
}

export interface SummarizeAgentWindowOptions {
  since: Date;
  until: Date;
  eventTypes: readonly string[];
  /** Cap on sample ids returned (newest first). Default 10. */
  sampleLimit?: number;
}

export interface StaleHeartbeatAgent {
  agentId: string;
  lastHeartbeatAt: Date;
}

export interface ListStaleHeartbeatOptions {
  /** Agents whose max heartbeat occurred_at is strictly before this instant. */
  olderThan: Date;
  limit: number;
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

  /**
   * Agent-scoped list + summary in one tenant transaction.
   * Uses occurred_at for time filters (index-friendly).
   */
  queryAgentEvents(
    tenantId: string,
    query: TelemetryQueryV1,
  ): Promise<TelemetryQueryResult>;

  /**
   * Counts + sample ids for an agent in an occurred_at window.
   * Used by correlation; empty eventTypes yields an empty summary.
   */
  summarizeAgentWindow(
    tenantId: string,
    agentId: string,
    options: SummarizeAgentWindowOptions,
  ): Promise<TelemetryWindowSummary>;

  /**
   * Latest heartbeat occurred_at for one agent, or null if never heartbeated.
   */
  getLastHeartbeatAt(
    tenantId: string,
    agentId: string,
  ): Promise<Date | null>;

  /**
   * Agents that have heartbeated at least once and whose last heartbeat is
   * strictly older than olderThan. Ordered by last heartbeat ascending.
   */
  listAgentsWithStaleHeartbeat(
    tenantId: string,
    options: ListStaleHeartbeatOptions,
  ): Promise<StaleHeartbeatAgent[]>;
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

function mapEventRow(row: {
  id: string;
  tenant_id: string;
  agent_id: string;
  schema_version: number;
  event_type: string;
  occurred_at: unknown;
  ingested_at: unknown;
  payload: unknown;
}): TelemetryEventRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    schemaVersion: row.schema_version,
    eventType: row.event_type,
    occurredAt: asDate(row.occurred_at),
    ingestedAt: asDate(row.ingested_at),
    payload: asPayload(row.payload),
  };
}

/**
 * All access runs through withTenantTransaction. tenant_id on inserts is always
 * the argument ΓÇö never taken from the event contract.
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

  async function buildSummary(
    trx: Transaction<Database>,
    query: TelemetryQueryV1,
  ): Promise<TelemetryAgentSummary> {
    let countsQuery = trx
      .selectFrom("telemetry_events")
      .select(["event_type", (eb) => eb.fn.countAll<string>().as("count")])
      .where("agent_id", "=", query.agentId)
      .groupBy("event_type");

    if (query.eventType) {
      countsQuery = countsQuery.where("event_type", "=", query.eventType);
    }
    if (query.since) {
      countsQuery = countsQuery.where("occurred_at", ">=", query.since);
    }
    if (query.until) {
      countsQuery = countsQuery.where("occurred_at", "<=", query.until);
    }

    const countRows = await countsQuery.execute();
    const countsByEventType: Record<string, number> = {};
    let totalInWindow = 0;
    for (const row of countRows) {
      const count = Number(row.count);
      countsByEventType[row.event_type] = count;
      totalInWindow += count;
    }

    let lastSeenQuery = trx
      .selectFrom("telemetry_events")
      .select((eb) => eb.fn.max("ingested_at").as("last_seen"))
      .where("agent_id", "=", query.agentId);

    if (query.eventType) {
      lastSeenQuery = lastSeenQuery.where("event_type", "=", query.eventType);
    }
    if (query.since) {
      lastSeenQuery = lastSeenQuery.where("occurred_at", ">=", query.since);
    }
    if (query.until) {
      lastSeenQuery = lastSeenQuery.where("occurred_at", "<=", query.until);
    }

    const lastSeenRow = await lastSeenQuery.executeTakeFirst();

    let lastHeartbeatQuery = trx
      .selectFrom("telemetry_events")
      .select((eb) => eb.fn.max("occurred_at").as("last_heartbeat"))
      .where("agent_id", "=", query.agentId)
      .where("event_type", "=", "heartbeat");

    if (query.since) {
      lastHeartbeatQuery = lastHeartbeatQuery.where(
        "occurred_at",
        ">=",
        query.since,
      );
    }
    if (query.until) {
      lastHeartbeatQuery = lastHeartbeatQuery.where(
        "occurred_at",
        "<=",
        query.until,
      );
    }

    // When the query filters to a non-heartbeat type, heartbeat last-seen in
    // that filtered set is intentionally null.
    const lastHeartbeatRow =
      query.eventType && query.eventType !== "heartbeat"
        ? { last_heartbeat: null }
        : await lastHeartbeatQuery.executeTakeFirst();

    return {
      agentId: query.agentId,
      lastSeenAt: lastSeenRow?.last_seen
        ? asDate(lastSeenRow.last_seen)
        : null,
      lastHeartbeatAt: lastHeartbeatRow?.last_heartbeat
        ? asDate(lastHeartbeatRow.last_heartbeat)
        : null,
      countsByEventType,
      totalInWindow,
    };
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

        return rows.map(mapEventRow);
      });
    },

    async queryAgentEvents(tenantId, query) {
      return withTenantTransaction(db, tenantId, async (trx) => {
        let listQuery = trx
          .selectFrom("telemetry_events")
          .selectAll()
          .where("agent_id", "=", query.agentId);

        if (query.eventType) {
          listQuery = listQuery.where("event_type", "=", query.eventType);
        }
        if (query.since) {
          listQuery = listQuery.where("occurred_at", ">=", query.since);
        }
        if (query.until) {
          listQuery = listQuery.where("occurred_at", "<=", query.until);
        }

        const rows = await listQuery
          .orderBy("occurred_at", "desc")
          .orderBy("ingested_at", "desc")
          .limit(query.limit)
          .offset(query.offset)
          .execute();

        const summary = await buildSummary(trx, query);

        return {
          events: rows.map(mapEventRow),
          summary,
        };
      });
    },

    async summarizeAgentWindow(tenantId, agentId, options) {
      const sampleLimit = Math.min(
        Math.max(1, options.sampleLimit ?? 10),
        20,
      );

      if (options.eventTypes.length === 0) {
        return {
          countsByType: {},
          total: 0,
          oldestOccurredAt: null,
          newestOccurredAt: null,
          sampleEventIds: [],
        };
      }

      return withTenantTransaction(db, tenantId, async (trx) => {
        const countRows = await trx
          .selectFrom("telemetry_events")
          .select(["event_type", (eb) => eb.fn.countAll<string>().as("count")])
          .where("agent_id", "=", agentId)
          .where("event_type", "in", [...options.eventTypes])
          .where("occurred_at", ">=", options.since)
          .where("occurred_at", "<=", options.until)
          .groupBy("event_type")
          .execute();

        const countsByType: Record<string, number> = {};
        let total = 0;
        for (const row of countRows) {
          const count = Number(row.count);
          countsByType[row.event_type] = count;
          total += count;
        }

        const bounds = await trx
          .selectFrom("telemetry_events")
          .select([
            (eb) => eb.fn.min("occurred_at").as("oldest"),
            (eb) => eb.fn.max("occurred_at").as("newest"),
          ])
          .where("agent_id", "=", agentId)
          .where("event_type", "in", [...options.eventTypes])
          .where("occurred_at", ">=", options.since)
          .where("occurred_at", "<=", options.until)
          .executeTakeFirst();

        const samples = await trx
          .selectFrom("telemetry_events")
          .select("id")
          .where("agent_id", "=", agentId)
          .where("event_type", "in", [...options.eventTypes])
          .where("occurred_at", ">=", options.since)
          .where("occurred_at", "<=", options.until)
          .orderBy("occurred_at", "desc")
          .limit(sampleLimit)
          .execute();

        return {
          countsByType,
          total,
          oldestOccurredAt: bounds?.oldest ? asDate(bounds.oldest) : null,
          newestOccurredAt: bounds?.newest ? asDate(bounds.newest) : null,
          sampleEventIds: samples.map((row) => row.id),
        };
      });
    },

    async getLastHeartbeatAt(tenantId, agentId) {
      return withTenantTransaction(db, tenantId, async (trx) => {
        const row = await trx
          .selectFrom("telemetry_events")
          .select((eb) => eb.fn.max("occurred_at").as("last_heartbeat"))
          .where("agent_id", "=", agentId)
          .where("event_type", "=", "heartbeat")
          .executeTakeFirst();

        return row?.last_heartbeat ? asDate(row.last_heartbeat) : null;
      });
    },

    async listAgentsWithStaleHeartbeat(tenantId, options) {
      const limit = Math.min(Math.max(1, options.limit), MAX_LIST_LIMIT);

      return withTenantTransaction(db, tenantId, async (trx) => {
        const rows = await trx
          .selectFrom("telemetry_events")
          .select([
            "agent_id",
            (eb) => eb.fn.max("occurred_at").as("last_heartbeat"),
          ])
          .where("event_type", "=", "heartbeat")
          .groupBy("agent_id")
          .having(sql`max(occurred_at)`, "<", options.olderThan)
          .orderBy(sql`max(occurred_at)`, "asc")
          .limit(limit)
          .execute();

        return rows.map((row) => ({
          agentId: row.agent_id,
          lastHeartbeatAt: asDate(row.last_heartbeat),
        }));
      });
    },
  };
}
