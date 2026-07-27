import { type Kysely, sql, type Transaction } from "kysely";

import type { Database } from "./schema";

/**
 * The only sanctioned path to tenant-owned data.
 *
 * Opens a transaction, sets `app.current_tenant` transaction-locally, then runs
 * the caller's work on that same transaction. The RLS policies on tenant-owned
 * tables read this setting, so every read and write inside `fn` is constrained
 * to the given tenant by the database itself.
 *
 * `set_config(..., true)` scopes the setting to the transaction: it resets on
 * commit or rollback and is never left on the pooled connection for the next
 * request. This is the property that prevents cross-tenant leakage under a
 * connection pool. Session-level SET must never be used for tenant context.
 *
 * Reaching for the pool or a bare Kysely instance to read tenant-owned data,
 * bypassing this helper, is a review-blocking defect (ADR-0004).
 */
export async function withTenantTransaction<T>(
  db: Kysely<Database>,
  tenantId: string,
  fn: (trx: Transaction<Database>) => Promise<T>,
): Promise<T> {
  // The sanctioned path must never establish an empty or blank tenant context:
  // an empty GUC would fail the RLS resolver on every row rather than scoping
  // the query. Reject before opening a transaction.
  if (typeof tenantId !== "string" || tenantId.trim() === "") {
    throw new Error("withTenantTransaction requires a non-empty tenantId");
  }

  return db.transaction().execute(async (trx) => {
    // tenantId is bound as a parameter, never interpolated into SQL text.
    await sql`select set_config('app.current_tenant', ${tenantId}, true)`.execute(trx);

    return fn(trx);
  });
}
