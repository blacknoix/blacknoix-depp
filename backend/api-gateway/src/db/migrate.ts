import * as path from "node:path";

import dotenv from "dotenv";
import { Kysely, PostgresDialect } from "kysely";
import { Migrator } from "kysely/migration";
import { Pool } from "pg";

import { LocalMigrationProvider } from "./migration-provider";
import type { Database } from "./schema";

dotenv.config({ quiet: true });

/**
 * Migration runner. Usage: `tsx src/db/migrate.ts <latest|down>`.
 *
 * Connects via DATABASE_MIGRATION_URL, which must be the privileged migrator
 * role (depp_migrator) — not the application role. Migrations create and own
 * tables and issue grants, which the least-privileged app role cannot do.
 *
 * Fail closed: refuse to migrate as a superuser. Superuser-owned tables break
 * the depp_migrator reset path and invite RLS-bypassing app connections.
 */
async function main(): Promise<void> {
  const direction = process.argv[2];

  if (direction !== "latest" && direction !== "down") {
    throw new Error("usage: migrate <latest|down>");
  }

  const connectionString = process.env.DATABASE_MIGRATION_URL;

  if (!connectionString || connectionString.trim() === "") {
    throw new Error(
      "DATABASE_MIGRATION_URL is required to run migrations. It must connect as " +
        "the privileged migrator role, never the application role.",
    );
  }

  const probe = new Pool({ connectionString, max: 1 });
  try {
    const { rows } = await probe.query<{
      role: string;
      super: string;
    }>(
      "select current_user as role, current_setting('is_superuser') as super",
    );
    const row = rows[0];
    if (!row || row.role !== "depp_migrator" || row.super === "on") {
      throw new Error(
        `DATABASE_MIGRATION_URL must connect as depp_migrator (NOSUPERUSER); ` +
          `got role=${row?.role ?? "unknown"} superuser=${row?.super ?? "unknown"}. ` +
          "If tables were already created as postgres, run " +
          "`npx tsx tests/db/repair-ownership.ts` once.",
      );
    }
  } finally {
    await probe.end();
  }

  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString }) }),
  });

  const migrator = new Migrator({
    db,
    provider: new LocalMigrationProvider(path.join(__dirname, "migrations")),
  });

  const { error, results } =
    direction === "latest"
      ? await migrator.migrateToLatest()
      : await migrator.migrateDown();

  for (const result of results ?? []) {
    console.log(
      JSON.stringify({
        migration: result.migrationName,
        direction: result.direction,
        status: result.status,
      }),
    );
  }

  await db.destroy();

  if (error) {
    console.error(error);
    process.exit(1);
  }
}

void main();
