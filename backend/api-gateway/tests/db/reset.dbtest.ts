import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { Pool } from "pg";

import {
  OPTIONAL_TENANT_RESET_TABLES,
  SCHEMA_RESET_TABLES,
  connectDb,
  resetSchema,
  seedTenant,
  type DbHandles,
} from "./helpers";

/**
 * Migrator is subject to FORCE RLS. Seed/count under an explicit tenant GUC.
 */
async function withMigratorTenant<T>(
  migrator: Pool,
  tenantId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await migrator.query("begin");
  try {
    await migrator.query(`select set_config('app.current_tenant', $1, true)`, [
      tenantId,
    ]);
    const result = await fn();
    await migrator.query("commit");
    return result;
  } catch (err) {
    await migrator.query("rollback");
    throw err;
  }
}

async function countUnderTenant(
  migrator: Pool,
  table: string,
  tenantId: string,
): Promise<number> {
  return withMigratorTenant(migrator, tenantId, async () => {
    const { rows } = await migrator.query<{ n: string }>(
      `select count(*)::text as n from ${table}`,
    );
    return Number(rows[0]?.n ?? "0");
  });
}

describe("db resetSchema clears tenant-owned fixtures", () => {
  let db: DbHandles;

  before(async () => {
    db = await connectDb();
  });

  after(async () => {
    await db.close();
  });

  it("empties schema tables and optional extras after seed", async () => {
    await resetSchema(db.migrator);

    const tenantId = await seedTenant(
      db.migrator,
      `reset-${randomUUID().slice(0, 8)}`,
    );
    const agentId = randomUUID();
    const userId = randomUUID();

    const findingId = await withMigratorTenant(db.migrator, tenantId, async () => {
      await db.migrator.query(
        `insert into agents (id, tenant_id, name) values ($1, $2, $3)`,
        [agentId, tenantId, "reset-agent"],
      );

      await db.migrator.query(
        `insert into finding_shared_views (tenant_id, name, status)
         values ($1, $2, $3)`,
        [tenantId, "reset-view", "open"],
      );

      const findingInsert = await db.migrator.query<{ id: string }>(
        `insert into correlation_findings (
           tenant_id, agent_id, rule_id, title, severity, evidence,
           window_start, window_end, window_bucket, status, detection_source
         ) values (
           $1, $2, 'agent.heartbeat_burst', 'reset finding', 'medium', '{}'::jsonb,
           now(), now(), now(), 'open', 'legacy_unspecified'
         ) returning id`,
        [tenantId, agentId],
      );

      const { rows: tables } = await db.migrator.query<{ tablename: string }>(
        `select tablename from pg_tables where schemaname = 'public'`,
      );
      const present = new Set(tables.map((row) => row.tablename));

      if (present.has("work_shared_views")) {
        await db.migrator.query(
          `insert into work_shared_views (tenant_id, name, sections)
           values ($1, $2, $3::text[])`,
          [tenantId, "reset-work-view", ["open"]],
        );
      }

      const id = findingInsert.rows[0].id;

      if (present.has("finding_attention_dismissals")) {
        await db.migrator.query(
          `insert into finding_attention_dismissals
             (tenant_id, user_id, finding_id, kind, condition_at)
           values ($1, $2, $3, 'finding.action_needed', now())`,
          [tenantId, userId, id],
        );
      }

      if (present.has("finding_revisit_reminders")) {
        await db.migrator.query(
          `insert into finding_revisit_reminders
             (tenant_id, finding_id, owner_user_id, remind_at, set_by_user_id)
           values ($1, $2, $3, now() + interval '1 day', $3)`,
          [tenantId, id, userId],
        );
      }

      if (present.has("work_tenant_defaults") && present.has("work_shared_views")) {
        const view = await db.migrator.query<{ id: string }>(
          `select id from work_shared_views where tenant_id = $1 limit 1`,
          [tenantId],
        );
        if (view.rows[0]) {
          await db.migrator.query(
            `insert into work_tenant_defaults (tenant_id, work_shared_view_id)
             values ($1, $2)
             on conflict do nothing`,
            [tenantId, view.rows[0].id],
          ).catch(() => undefined);
        }
      }

      return id;
    });

    assert.ok(findingId);

    const { rows: tablesAfterSeed } = await db.migrator.query<{
      tablename: string;
    }>(`select tablename from pg_tables where schemaname = 'public'`);
    const present = new Set(tablesAfterSeed.map((row) => row.tablename));

    await resetSchema(db.migrator);

    // Registry / global tables — no FORCE RLS raise without tenant GUC.
    for (const table of ["tenants", "oidc_initiations"] as const) {
      const { rows } = await db.migrator.query<{ n: string }>(
        `select count(*)::text as n from ${table}`,
      );
      assert.equal(rows[0]?.n, "0", `${table} must be empty after reset`);
    }

    const probeTenant = randomUUID();
    const tenantScoped = SCHEMA_RESET_TABLES.filter(
      (table) => table !== "tenants" && table !== "oidc_initiations",
    );

    for (const table of tenantScoped) {
      const n = await countUnderTenant(db.migrator, table, probeTenant);
      assert.equal(n, 0, `${table} must be empty after reset`);
    }

    for (const table of OPTIONAL_TENANT_RESET_TABLES) {
      if (!present.has(table)) {
        continue;
      }
      const n = await countUnderTenant(db.migrator, table, probeTenant);
      assert.equal(n, 0, `optional table ${table} must be empty after reset`);
    }
  });
});
