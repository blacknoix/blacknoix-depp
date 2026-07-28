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

/**
 * Tenant-owned + registry tables declared in src/db/schema.ts Database.
 * Must exist after migrate:latest on this branch.
 */
export const SCHEMA_RESET_TABLES = [
  "threat_events",
  "device_identities",
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

/**
 * Extra tenant-owned tables that may exist on a developer database that once
 * ran newer migrations from another branch. Included in TRUNCATE when present
 * so reset does not leave orphan fixture rows. Not part of this branch's
 * schema.ts until those migrations land here.
 */
export const OPTIONAL_TENANT_RESET_TABLES = [
  "work_tenant_defaults",
  "work_shared_views",
  "finding_attention_dismissals",
  "finding_revisit_reminders",
] as const;

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value || value.trim() === "") {
    throw new Error(
      `The database-backed isolation suite requires ${name}, which is not set. ` +
        "Start Postgres (docker compose -f infra/docker-compose.yml up -d), run " +
        "`npm run migrate:latest`, and set DATABASE_URL and DATABASE_MIGRATION_URL. " +
        "This suite fails rather than skipping: tenant isolation must never be " +
        "silently unverified.",
    );
  }

  return value;
}

/**
 * Opens both connections and proves they are reachable. Throws — never skips —
 * if the environment is missing or the database is unavailable.
 */
export async function connectDb(): Promise<DbHandles> {
  const appUrl = requireEnv("DATABASE_URL");
  const migratorUrl = requireEnv("DATABASE_MIGRATION_URL");

  const appPool = new Pool({ connectionString: appUrl, max: 4 });
  const migratorPool = new Pool({ connectionString: migratorUrl, max: 2 });

  // Fail loudly now, with a clear error, rather than deep inside a test.
  await migratorPool.query("select 1");
  await appPool.query("select 1");

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
 * Contract:
 * - SCHEMA_RESET_TABLES must all exist (fail closed if a migration is missing).
 * - OPTIONAL_TENANT_RESET_TABLES are truncated when present.
 * - CASCADE also clears any other tables that FK into the truncated set
 *   (defense in depth for unexpected local relations).
 */
export async function resetSchema(migrator: Pool): Promise<void> {
  const { rows } = await migrator.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public'`,
  );
  const present = new Set(rows.map((row) => row.tablename));

  for (const table of SCHEMA_RESET_TABLES) {
    if (!present.has(table)) {
      throw new Error(
        `resetSchema: required table "${table}" is missing. ` +
          "Run migrations to latest so schema.ts and the database agree.",
      );
    }
  }

  const tables = [
    ...OPTIONAL_TENANT_RESET_TABLES.filter((table) => present.has(table)),
    ...SCHEMA_RESET_TABLES,
  ];

  await migrator.query(
    `truncate table ${tables.join(", ")} restart identity cascade`,
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

/**
 * Seeds an active Ed25519 device identity for THREATEVENT submit (dev/test).
 * public_key is a unique base64url placeholder (crypto verify deferred).
 */
export async function seedDeviceIdentity(
  migrator: Pool,
  tenantId: string,
  agentId: string,
  publicKeyEd25519?: string,
): Promise<string> {
  const key =
    publicKeyEd25519 ??
    Buffer.from(`dev-pk-${tenantId}-${agentId}`).toString("base64url");

  await migrator.query("begin");
  try {
    await migrator.query(`select set_config('app.current_tenant', $1, true)`, [
      tenantId,
    ]);
    const result = await migrator.query<{ id: string }>(
      `insert into device_identities
         (tenant_id, agent_id, public_key_ed25519, status)
       values ($1, $2, $3, 'active')
       returning id`,
      [tenantId, agentId, key],
    );
    await migrator.query("commit");
    return result.rows[0].id;
  } catch (err) {
    await migrator.query("rollback");
    throw err;
  }
}
