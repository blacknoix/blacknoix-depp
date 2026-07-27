import type { Kysely } from "kysely";

import type { Database } from "../db/schema";
import { withTenantTransaction } from "../db/tenant-context";
import type { SharedFindingViewFilters } from "./contract";
import { SHARED_VIEWS_MAX_PER_TENANT } from "./contract";

export interface FindingSharedViewRow {
  id: string;
  tenantId: string;
  name: string;
  filters: SharedFindingViewFilters;
  createdAt: Date;
  createdByUserId: string | null;
}

export interface FindingSharedViewInsert {
  name: string;
  filters: SharedFindingViewFilters;
  createdByUserId: string | null;
}

export type InsertSharedViewResult =
  | { ok: true; view: FindingSharedViewRow }
  | { ok: false; reason: "conflict" | "limit" };

export interface FindingSharedViewsRepository {
  list(tenantId: string): Promise<FindingSharedViewRow[]>;
  insert(
    tenantId: string,
    input: FindingSharedViewInsert,
  ): Promise<InsertSharedViewResult>;
  deleteById(
    tenantId: string,
    id: string,
  ): Promise<FindingSharedViewRow | undefined>;
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
  name: string;
  status: string | null;
  rule_id: string | null;
  agent_id: string | null;
  owner_scope: string | null;
  created_at: unknown;
  created_by_user_id: string | null;
}): FindingSharedViewRow {
  const filters: SharedFindingViewFilters = {};
  if (row.status) {
    filters.status = row.status as SharedFindingViewFilters["status"];
  }
  if (row.rule_id) {
    filters.ruleId = row.rule_id as SharedFindingViewFilters["ruleId"];
  }
  if (row.agent_id) {
    filters.agentId = row.agent_id;
  }
  if (row.owner_scope === "me" || row.owner_scope === "none") {
    filters.ownerScope = row.owner_scope;
  }
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    filters,
    createdAt: asDate(row.created_at),
    createdByUserId: row.created_by_user_id,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

export function createFindingSharedViewsRepository(
  db: Kysely<Database>,
): FindingSharedViewsRepository {
  return {
    async list(tenantId) {
      return withTenantTransaction(db, tenantId, async (trx) => {
        const rows = await trx
          .selectFrom("finding_shared_views")
          .selectAll()
          .orderBy("created_at", "desc")
          .execute();
        return rows.map(mapRow);
      });
    },

    async insert(tenantId, input) {
      return withTenantTransaction(db, tenantId, async (trx) => {
        const countRow = await trx
          .selectFrom("finding_shared_views")
          .select((eb) => eb.fn.countAll<string>().as("count"))
          .executeTakeFirstOrThrow();
        const count = Number(countRow.count);
        if (count >= SHARED_VIEWS_MAX_PER_TENANT) {
          return { ok: false, reason: "limit" };
        }

        try {
          const row = await trx
            .insertInto("finding_shared_views")
            .values({
              tenant_id: tenantId,
              name: input.name,
              status: input.filters.status ?? null,
              rule_id: input.filters.ruleId ?? null,
              agent_id: input.filters.agentId ?? null,
              owner_scope: input.filters.ownerScope ?? null,
              created_by_user_id: input.createdByUserId,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
          return { ok: true, view: mapRow(row) };
        } catch (err) {
          if (isUniqueViolation(err)) {
            return { ok: false, reason: "conflict" };
          }
          throw err;
        }
      });
    },

    async deleteById(tenantId, id) {
      return withTenantTransaction(db, tenantId, async (trx) => {
        const row = await trx
          .deleteFrom("finding_shared_views")
          .where("id", "=", id)
          .returningAll()
          .executeTakeFirst();
        return row ? mapRow(row) : undefined;
      });
    },
  };
}
