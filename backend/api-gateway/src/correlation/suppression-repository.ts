import type { Kysely } from "kysely";

import type { Database } from "../db/schema";
import { withTenantTransaction } from "../db/tenant-context";
import type { CorrelationRuleId } from "./rules";

export interface FindingSuppressionInsert {
  ruleId: CorrelationRuleId;
  startsAt: Date;
  endsAt: Date;
  createdByUserId: string | null;
}

export interface FindingSuppressionRow {
  id: string;
  tenantId: string;
  ruleId: string;
  startsAt: Date;
  endsAt: Date;
  createdAt: Date;
  createdByUserId: string | null;
  clearedAt: Date | null;
  clearedByUserId: string | null;
}

export interface FindingSuppressionsRepository {
  /**
   * Inserts a snooze. Fails with conflict when an uncleared row already exists
   * for the same tenant+rule (caller maps to a 409).
   */
  insertSuppression(
    tenantId: string,
    input: FindingSuppressionInsert,
  ): Promise<FindingSuppressionRow>;

  getById(
    tenantId: string,
    id: string,
  ): Promise<FindingSuppressionRow | undefined>;

  /**
   * Soft-clears an uncleared snooze. Returns undefined when missing or already
   * cleared (non-oracular for the route).
   */
  clearSuppression(
    tenantId: string,
    id: string,
    clearedAt: Date,
    clearedByUserId: string | null,
  ): Promise<FindingSuppressionRow | undefined>;

  /** Uncleared rows for the tenant (active and future/expired-but-uncleared). */
  listUncleared(
    tenantId: string,
    options?: { limit?: number },
  ): Promise<FindingSuppressionRow[]>;

  /**
   * True when an uncleared snooze covers `ruleId` at `at`
   * (starts_at <= at < ends_at).
   */
  isRuleSuppressedAt(
    tenantId: string,
    ruleId: CorrelationRuleId,
    at: Date,
  ): Promise<boolean>;
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

function mapRow(row: {
  id: string;
  tenant_id: string;
  rule_id: string;
  starts_at: unknown;
  ends_at: unknown;
  created_at: unknown;
  created_by_user_id: string | null;
  cleared_at: unknown;
  cleared_by_user_id: string | null;
}): FindingSuppressionRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    ruleId: row.rule_id,
    startsAt: asDate(row.starts_at),
    endsAt: asDate(row.ends_at),
    createdAt: asDate(row.created_at),
    createdByUserId: row.created_by_user_id,
    clearedAt: row.cleared_at ? asDate(row.cleared_at) : null,
    clearedByUserId: row.cleared_by_user_id,
  };
}

const MAX_LIST = 100;

export function createFindingSuppressionsRepository(
  db: Kysely<Database>,
): FindingSuppressionsRepository {
  return {
    async insertSuppression(tenantId, input) {
      return withTenantTransaction(db, tenantId, async (trx) => {
        const row = await trx
          .insertInto("finding_suppressions")
          .values({
            tenant_id: tenantId,
            rule_id: input.ruleId,
            starts_at: input.startsAt,
            ends_at: input.endsAt,
            created_by_user_id: input.createdByUserId,
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        return mapRow(row);
      });
    },

    async getById(tenantId, id) {
      return withTenantTransaction(db, tenantId, async (trx) => {
        const row = await trx
          .selectFrom("finding_suppressions")
          .selectAll()
          .where("id", "=", id)
          .executeTakeFirst();

        return row ? mapRow(row) : undefined;
      });
    },

    async clearSuppression(tenantId, id, clearedAt, clearedByUserId) {
      return withTenantTransaction(db, tenantId, async (trx) => {
        const row = await trx
          .updateTable("finding_suppressions")
          .set({
            cleared_at: clearedAt,
            cleared_by_user_id: clearedByUserId,
          })
          .where("id", "=", id)
          .where("cleared_at", "is", null)
          .returningAll()
          .executeTakeFirst();

        return row ? mapRow(row) : undefined;
      });
    },

    async listUncleared(tenantId, options = {}) {
      const limit = Math.min(Math.max(1, options.limit ?? 50), MAX_LIST);

      return withTenantTransaction(db, tenantId, async (trx) => {
        const rows = await trx
          .selectFrom("finding_suppressions")
          .selectAll()
          .where("cleared_at", "is", null)
          .orderBy("created_at", "desc")
          .limit(limit)
          .execute();

        return rows.map(mapRow);
      });
    },

    async isRuleSuppressedAt(tenantId, ruleId, at) {
      return withTenantTransaction(db, tenantId, async (trx) => {
        const row = await trx
          .selectFrom("finding_suppressions")
          .select("id")
          .where("rule_id", "=", ruleId)
          .where("cleared_at", "is", null)
          .where("starts_at", "<=", at)
          .where("ends_at", ">", at)
          .executeTakeFirst();

        return row !== undefined;
      });
    },
  };
}
