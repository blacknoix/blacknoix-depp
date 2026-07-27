import { type Kysely } from "kysely";
import { Pool } from "pg";

import { createKysely } from "../../src/db/kysely";
import type { Database } from "../../src/db/schema";

/**
 * Connections for the database-backed isolation suite.
 *
 * `app` connects as the least-privileged application role (depp_app) — the role
 * whose isolation is under test. `migrator` connects as the privileged owner
 * role (depp_migrator) and is used only to seed and reset fixtures, never to
 * assert isolation.
 */
export interface DbHandles {
  app: Kysely<Database>;
  migrator: Pool;
  close: () => Promise<void>;
}

/** Tenant-owned + registry tables cleared between dbtests (owner connection). */
const RESET_TABLES = [
  "work_tenant_defaults",
  "work_shared_views",
  "finding_attention_dismissals",
  "finding_revisit_reminders",
  "finding_shared_views",
  "finding_suppressions",
  "correlation_findings",
  "telemetry_events",
  "agent_credentials",
  "oidc_initiations",
  "refresh_tokens",
  "sessions",
  "users",
  "agents",
  "tenants",
] as const;

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value || value.trim() === "") {
    throw new Error(
      `The database-backed isolation suite requires ${name}, which is not set. ` +
        "Start Postgres (docker compose -f infra/docker-compose.yml up -d), run " +
        "`npm run migrate:latest`, and set DATABASE_URL and DATABASE_MIGRATION_URL " +
        "(see tests/test.env). This suite fails rather than skipping: tenant " +
        "isolation must never be silently unverified.",
    );
  }

  return value;
}

async function assertRole(
  pool: Pool,
  expected: { role: string; allowSuper: boolean; label: string },
): Promise<void> {
  const { rows } = await pool.query<{
    role: string;
    super: string;
    bypass: boolean;
  }>(
    `select current_user as role,
            current_setting('is_superuser') as super,
            (select rolbypassrls from pg_roles where rolname = current_user) as bypass`,
  );
  const row = rows[0];
  if (!row) {
    throw new Error(`${expected.label}: could not resolve connection role`);
  }
  if (row.role !== expected.role) {
    throw new Error(
      `${expected.label} must connect as ${expected.role}, got ${row.role}. ` +
        "A superuser or table-owner connection bypasses / weakens RLS and makes " +
        "isolation tests meaningless.",
    );
  }
  if (!expected.allowSuper && row.super === "on") {
    throw new Error(
      `${expected.label} must not be a superuser (got ${row.role}).`,
    );
  }
  if (row.bypass) {
    throw new Error(
      `${expected.label} must be NOBYPASSRLS (role ${row.role} has BYPASSRLS).`,
    );
  }
}

/**
 * Opens both connections and proves they are reachable with the correct roles.
 * Throws — never skips — if the environment is missing or roles are wrong.
 */
export async function connectDb(): Promise<DbHandles> {
  const appUrl = requireEnv("DATABASE_URL");
  const migratorUrl = requireEnv("DATABASE_MIGRATION_URL");

  const appPool = new Pool({ connectionString: appUrl, max: 4 });
  const migratorPool = new Pool({ connectionString: migratorUrl, max: 2 });

  try {
    await migratorPool.query("select 1");
    await appPool.query("select 1");
    await assertRole(appPool, {
      role: "depp_app",
      allowSuper: false,
      label: "DATABASE_URL",
    });
    await assertRole(migratorPool, {
      role: "depp_migrator",
      allowSuper: false,
      label: "DATABASE_MIGRATION_URL",
    });
  } catch (err) {
    await appPool.end().catch(() => undefined);
    await migratorPool.end().catch(() => undefined);
    throw err;
  }

  const app = createKysely(appPool);

  return {
    app,
    migrator: migratorPool,
    close: async () => {
      await app.destroy();
      await migratorPool.end();
    },
  };
}

/**
 * Clears fixture data via the owner connection.
 *
 * TRUNCATE is used rather than DELETE: RLS does not gate TRUNCATE, whereas a
 * DELETE issued by the owner with FORCE RLS and no tenant context would hit the
 * policy's one-argument current_setting and fail closed.
 *
 * IMPORTANT: every *.dbtest.ts file shares one Postgres database and resets it
 * globally here. The suites must therefore run serially, or one file's TRUNCATE
 * will pull fixtures out from under another's inserts (FK violations, duplicate
 * slugs). This is enforced by `--test-concurrency=1` in the `test:db` script; do
 * not remove it without giving each file its own isolated data.
 *
 * Tables must be owned by depp_migrator. If truncate fails with permission
 * denied, migrations were likely applied as postgres — run
 * `npx tsx tests/db/repair-ownership.ts` then remigrate only if needed.
 */
export async function resetSchema(migrator: Pool): Promise<void> {
  await migrator.query(
    `truncate table ${RESET_TABLES.join(", ")} restart identity cascade`,
  );
}

/** Inserts a tenant via the owner connection and returns its generated id. */
export async function seedTenant(migrator: Pool, slug: string): Promise<string> {
  const result = await migrator.query<{ id: string }>(
    "insert into tenants (slug, name) values ($1, $2) returning id",
    [slug, slug],
  );

  return result.rows[0].id;
}
