import { Kysely, PostgresDialect } from "kysely";
import type { Pool } from "pg";

import type { Database } from "./schema";

/**
 * Wraps an existing `pg` Pool in a typed Kysely instance.
 *
 * Takes the pool rather than a connection string so it composes with the pool
 * created in db/pool.ts, and so tests and the migration runner can supply their
 * own pool (a different role) without a second connection-management path.
 */
export function createKysely(pool: Pool): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });
}
