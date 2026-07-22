import type { ColumnType, Generated } from "kysely";

/**
 * Kysely schema types for api-gateway.
 *
 * This interface must be kept in step with the migrations in ./migrations,
 * which are the source of truth for the real database shape. A future codegen or
 * drift check should enforce that; for now it is maintained by hand (ADR-0004).
 */

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

/**
 * Platform-global tenant registry. No RLS: ADR-0001 permits truly global tables
 * to omit tenant scoping. Visibility of the registry itself is a later concern.
 */
export interface TenantsTable {
  id: Generated<string>;
  slug: string;
  name: string;
  created_at: Generated<Timestamp>;
}

/**
 * Tenant-owned. Isolation is enforced by PostgreSQL RLS keyed on
 * `app.current_tenant`, never by application-level filters (ADR-0001, ADR-0004).
 * Every access must go through withTenantTransaction.
 */
export interface AgentsTable {
  id: Generated<string>;
  tenant_id: string;
  name: string;
  created_at: Generated<Timestamp>;
}

export interface Database {
  tenants: TenantsTable;
  agents: AgentsTable;
}
