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
 */
export async function resetSchema(migrator: Pool): Promise<void> {
  await migrator.query("truncate table agents, tenants restart identity cascade");
}

/** Inserts a tenant via the owner connection and returns its generated id. */
export async function seedTenant(migrator: Pool, slug: string): Promise<string> {
  const result = await migrator.query<{ id: string }>(
    "insert into tenants (slug, name) values ($1, $2) returning id",
    [slug, slug],
  );

  return result.rows[0].id;
}
