import type { Kysely } from "kysely";

import type { Database } from "../db/schema";
import { withTenantTransaction } from "../db/tenant-context";
import {
  canonicalizeWorkSections,
  isWorkViewSectionId,
  WORK_SHARED_VIEWS_MAX_PER_TENANT,
  type SharedWorkViewDefinition,
  type WorkViewSectionId,
} from "./contract";

export interface WorkSharedViewRow {
  id: string;
  tenantId: string;
  name: string;
  definition: SharedWorkViewDefinition;
  createdAt: Date;
  createdByUserId: string | null;
}

export interface WorkSharedViewInsert {
  name: string;
  definition: SharedWorkViewDefinition;
  createdByUserId: string | null;
}

export type InsertSharedWorkViewResult =
  | { ok: true; view: WorkSharedViewRow }
  | { ok: false; reason: "conflict" | "limit" };

export interface WorkSharedViewsRepository {
  list(tenantId: string): Promise<WorkSharedViewRow[]>;
  insert(
    tenantId: string,
    input: WorkSharedViewInsert,
  ): Promise<InsertSharedWorkViewResult>;
  deleteById(
    tenantId: string,
    id: string,
  ): Promise<WorkSharedViewRow | undefined>;
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

function mapSections(raw: unknown): WorkViewSectionId[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const parsed: WorkViewSectionId[] = [];
  for (const entry of raw) {
    if (typeof entry === "string" && isWorkViewSectionId(entry)) {
      parsed.push(entry);
    }
  }
  return canonicalizeWorkSections(parsed);
}

function mapRow(row: {
  id: string;
  tenant_id: string;
  name: string;
  sections: unknown;
  created_at: unknown;
  created_by_user_id: string | null;
}): WorkSharedViewRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    definition: { sections: mapSections(row.sections) },
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

export function createWorkSharedViewsRepository(
  db: Kysely<Database>,
): WorkSharedViewsRepository {
  return {
    async list(tenantId) {
      return withTenantTransaction(db, tenantId, async (trx) => {
        const rows = await trx
          .selectFrom("work_shared_views")
          .selectAll()
          .orderBy("created_at", "desc")
          .execute();
        return rows.map(mapRow).filter((row) => row.definition.sections.length > 0);
      });
    },

    async insert(tenantId, input) {
      return withTenantTransaction(db, tenantId, async (trx) => {
        const countRow = await trx
          .selectFrom("work_shared_views")
          .select((eb) => eb.fn.countAll<string>().as("count"))
          .executeTakeFirstOrThrow();
        const count = Number(countRow.count);
        if (count >= WORK_SHARED_VIEWS_MAX_PER_TENANT) {
          return { ok: false, reason: "limit" };
        }

        const sections = canonicalizeWorkSections(input.definition.sections);
        if (sections.length === 0) {
          throw new Error("insert requires a non-empty sections list");
        }

        try {
          const row = await trx
            .insertInto("work_shared_views")
            .values({
              tenant_id: tenantId,
              name: input.name,
              sections,
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
          .deleteFrom("work_shared_views")
          .where("id", "=", id)
          .returningAll()
          .executeTakeFirst();
        return row ? mapRow(row) : undefined;
      });
    },
  };
}
