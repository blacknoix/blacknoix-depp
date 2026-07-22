import * as path from "node:path";

import { Kysely, PostgresDialect } from "kysely";
import { Migrator } from "kysely/migration";
import { Pool } from "pg";

import { LocalMigrationProvider } from "./migration-provider";
import type { Database } from "./schema";

/**
 * Migration runner. Usage: `tsx src/db/migrate.ts <latest|down>`.
 *
 * Connects via DATABASE_MIGRATION_URL, which must be the privileged migrator
 * role (depp_migrator) — not the application role. Migrations create and own
 * tables and issue grants, which the least-privileged app role cannot do.
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
