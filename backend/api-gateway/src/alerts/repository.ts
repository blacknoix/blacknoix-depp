import type { Kysely, Transaction } from "kysely";
import { sql } from "kysely";

import type { Database } from "../db/schema";
import { withTenantTransaction } from "../db/tenant-context";
import {
  AUTH_FAILURE_BURST_RULE_ID,
  AUTH_FAILURE_BURST_THRESHOLD,
  AUTH_FAILURE_EVENT_TYPE,
  authFailureWindowBounds,
  floorToAuthFailureWindowBucket,
} from "./rule";

export interface AlertRow {
  id: string;
  tenantId: string;
  agentId: string;
  ruleId: string;
  windowBucket: Date;
  windowStart: Date;
  windowEnd: Date;
  contributingCount: number;
  contributingEventIds: string[];
  createdAt: Date;
}

export interface AlertAuditRow {
  id: string;
  tenantId: string;
  alertId: string;
  eventType: string;
  occurredAt: Date;
  actorKind: string;
  actorId: string | null;
  detail: Record<string, unknown>;
}

export interface ListAlertsQuery {
  agentId?: string;
  limit?: number;
}

function asDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    return new Date(value);
  }
  throw new Error("expected a timestamp value");
}

function asUuidArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v));
  }
  return [];
}

function mapAlert(row: {
  id: string;
  tenant_id: string;
  agent_id: string;
  rule_id: string;
  window_bucket: unknown;
  window_start: unknown;
  window_end: unknown;
  contributing_count: number;
  contributing_event_ids: unknown;
  created_at: unknown;
}): AlertRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    ruleId: row.rule_id,
    windowBucket: asDate(row.window_bucket),
    windowStart: asDate(row.window_start),
    windowEnd: asDate(row.window_end),
    contributingCount: Number(row.contributing_count),
    contributingEventIds: asUuidArray(row.contributing_event_ids),
    createdAt: asDate(row.created_at),
  };
}

function mapAudit(row: {
  id: string;
  tenant_id: string;
  alert_id: string;
  event_type: string;
  occurred_at: unknown;
  actor_kind: string;
  actor_id: string | null;
  detail: unknown;
}): AlertAuditRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    alertId: row.alert_id,
    eventType: row.event_type,
    occurredAt: asDate(row.occurred_at),
    actorKind: row.actor_kind,
    actorId: row.actor_id,
    detail:
      typeof row.detail === "object" &&
      row.detail !== null &&
      !Array.isArray(row.detail)
        ? (row.detail as Record<string, unknown>)
        : {},
  };
}

export interface AuthFailureBurstHooks {
  /**
   * Test-only seam: throw before audit insert to prove durable-before-success
   * rollback. Not used in production wiring.
   */
  beforeAuditInsert?: () => void;
}

export interface AlertsRepository {
  /**
   * Inserts a telemetry auth_failure event, evaluates the burst rule, and
   * materializes alert + alert_created audit in the SAME tenant transaction.
   * Failures propagate (no swallow).
   */
  ingestAuthFailureAndEvaluate(
    tenantId: string,
    input: {
      agentId: string;
      schemaVersion: number;
      occurredAt: Date;
      payload: Record<string, unknown>;
    },
  ): Promise<{ id: string; ingestedAt: Date }>;

  listAlerts(tenantId: string, query?: ListAlertsQuery): Promise<AlertRow[]>;

  getAlertById(tenantId: string, alertId: string): Promise<AlertRow | undefined>;

  listAuditForAlert(
    tenantId: string,
    alertId: string,
  ): Promise<AlertAuditRow[]>;
}

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;

export function createAlertsRepository(
  db: Kysely<Database>,
  hooks: AuthFailureBurstHooks = {},
): AlertsRepository {
  return {
    async ingestAuthFailureAndEvaluate(tenantId, input) {
      if (typeof tenantId !== "string" || tenantId.trim() === "") {
        throw new Error("ingestAuthFailureAndEvaluate requires tenantId");
      }

      return withTenantTransaction(db, tenantId, async (trx) => {
        const inserted = await trx
          .insertInto("telemetry_events")
          .values({
            tenant_id: tenantId,
            agent_id: input.agentId,
            schema_version: input.schemaVersion,
            event_type: AUTH_FAILURE_EVENT_TYPE,
            occurred_at: input.occurredAt,
            payload: input.payload,
          })
          .returning(["id", "ingested_at"])
          .executeTakeFirstOrThrow();

        const bucket = floorToAuthFailureWindowBucket(input.occurredAt);
        const { windowStart, windowEnd } = authFailureWindowBounds(bucket);

        const eventRows = await trx
          .selectFrom("telemetry_events")
          .select(["id", "occurred_at"])
          .where("agent_id", "=", input.agentId)
          .where("event_type", "=", AUTH_FAILURE_EVENT_TYPE)
          .where("occurred_at", ">=", windowStart)
          .where("occurred_at", "<", windowEnd)
          .orderBy("occurred_at", "asc")
          .orderBy("id", "asc")
          .execute();

        const contributingEventIds = eventRows.map((row) => row.id);
        const contributingCount = contributingEventIds.length;

        if (contributingCount >= AUTH_FAILURE_BURST_THRESHOLD) {
          const created = await insertAlertIgnoreDup(trx, {
            tenantId,
            agentId: input.agentId,
            windowBucket: bucket,
            windowStart,
            windowEnd,
            contributingCount,
            contributingEventIds,
          });

          if (created) {
            if (hooks.beforeAuditInsert) {
              hooks.beforeAuditInsert();
            }
            await trx
              .insertInto("alert_audit_events")
              .values({
                tenant_id: tenantId,
                alert_id: created.id,
                event_type: "alert_created",
                actor_kind: "system",
                actor_id: AUTH_FAILURE_BURST_RULE_ID,
                detail: {
                  ruleId: AUTH_FAILURE_BURST_RULE_ID,
                  windowBucket: bucket.toISOString(),
                  contributingCount,
                },
              })
              .execute();
          }
        }

        return {
          id: inserted.id,
          ingestedAt: asDate(inserted.ingested_at),
        };
      });
    },

    async listAlerts(tenantId, query = {}) {
      const limit = Math.min(
        Math.max(query.limit ?? DEFAULT_LIST_LIMIT, 1),
        MAX_LIST_LIMIT,
      );

      return withTenantTransaction(db, tenantId, async (trx) => {
        let q = trx
          .selectFrom("alerts")
          .selectAll()
          .orderBy("created_at", "desc")
          .limit(limit);

        if (query.agentId) {
          q = q.where("agent_id", "=", query.agentId);
        }

        const rows = await q.execute();
        return rows.map(mapAlert);
      });
    },

    async getAlertById(tenantId, alertId) {
      return withTenantTransaction(db, tenantId, async (trx) => {
        const row = await trx
          .selectFrom("alerts")
          .selectAll()
          .where("id", "=", alertId)
          .executeTakeFirst();
        return row ? mapAlert(row) : undefined;
      });
    },

    async listAuditForAlert(tenantId, alertId) {
      return withTenantTransaction(db, tenantId, async (trx) => {
        const rows = await trx
          .selectFrom("alert_audit_events")
          .selectAll()
          .where("alert_id", "=", alertId)
          .orderBy("occurred_at", "asc")
          .execute();
        return rows.map(mapAudit);
      });
    },
  };
}

async function insertAlertIgnoreDup(
  trx: Transaction<Database>,
  input: {
    tenantId: string;
    agentId: string;
    windowBucket: Date;
    windowStart: Date;
    windowEnd: Date;
    contributingCount: number;
    contributingEventIds: string[];
  },
): Promise<{ id: string } | undefined> {
  // ON CONFLICT DO NOTHING — re-evaluation in the same bucket is idempotent.
  const result = await sql<{ id: string }>`
    insert into alerts (
      tenant_id,
      agent_id,
      rule_id,
      window_bucket,
      window_start,
      window_end,
      contributing_count,
      contributing_event_ids
    ) values (
      ${input.tenantId}::uuid,
      ${input.agentId}::uuid,
      ${AUTH_FAILURE_BURST_RULE_ID},
      ${input.windowBucket},
      ${input.windowStart},
      ${input.windowEnd},
      ${input.contributingCount},
      ${sql`ARRAY[${sql.join(
        input.contributingEventIds.map((id) => sql`${id}::uuid`),
      )}]::uuid[]`}
    )
    on conflict (tenant_id, agent_id, rule_id, window_bucket) do nothing
    returning id
  `.execute(trx);

  const id = result.rows[0]?.id;
  return id ? { id } : undefined;
}
