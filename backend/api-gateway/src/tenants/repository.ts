import type { Kysely } from "kysely";

import type { Database } from "../db/schema";
import { withTenantTransaction } from "../db/tenant-context";

export interface TenantView {
  id: string;
  slug: string;
  name: string;
}

/** Resolves a tenant id to its registry record, or undefined if there is none. */
export type TenantLookup = (tenantId: string) => Promise<TenantView | undefined>;

export interface TenantsRepository {
  findById: TenantLookup;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads the tenant registry through the sanctioned tenant-context path.
 *
 * The read runs inside withTenantTransaction, so RLS on the tenants table
 * constrains it to the caller's own row at the database. The explicit
 * `where id = ...` is the ADR-0001 second layer: application scoping on top of
 * the database guarantee, not a replacement for it.
 */
export function createTenantsRepository(db: Kysely<Database>): TenantsRepository {
  return {
    async findById(tenantId) {
      // A non-UUID cannot be a real tenant id. Rejecting it here keeps it out of
      // the uuid cast in current_tenant_id() (which would raise) and is where
      // readable development values such as "tenant-dev-001" stop resolving
      // (ADR-0004 slice C).
      if (!UUID.test(tenantId)) {
        return undefined;
      }

      return withTenantTransaction(db, tenantId, async (trx) => {
        const row = await trx
          .selectFrom("tenants")
          .select(["id", "slug", "name"])
          .where("id", "=", tenantId)
          .executeTakeFirst();

        return row ?? undefined;
      });
    },
  };
}
