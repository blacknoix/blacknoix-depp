import type { ColumnType, Generated } from "kysely";

/**
 * Kysely schema types for api-gateway.
 *
 * This interface must be kept in step with the migrations in ./migrations,
 * which are the source of truth for the real database shape. A future codegen or
 * drift check should enforce that; for now it is maintained by hand (ADR-0004).
 */

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type NullableTimestamp = ColumnType<
  Date | null,
  Date | string | null | undefined,
  Date | string | null
>;

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

/**
 * Tenant-owned. One row per authenticated human (ADR-0003 §9). Identity is
 * keyed by (tenant_id, issuer, subject); email and display_name are cached
 * presentation fields, never identity keys. `id` is the stable anchor that
 * sessions, refresh tokens, and role grants reference.
 */
export interface UsersTable {
  id: Generated<string>;
  tenant_id: string;
  issuer: string;
  subject: string;
  email: string | null;
  display_name: string | null;
  created_at: Generated<Timestamp>;
}

/**
 * Tenant-owned. One row per authenticated session, anchored to a users row
 * (ADR-0003 §4). revoked_at null means active; setting it blocks future refresh.
 */
export interface SessionsTable {
  id: Generated<string>;
  tenant_id: string;
  user_id: string;
  created_at: Generated<Timestamp>;
  revoked_at: NullableTimestamp;
}

/**
 * Tenant-owned. Opaque, one-time-use refresh tokens bound to a session. Only the
 * SHA-256 hash is stored; consumed_at null means usable.
 */
export interface RefreshTokensTable {
  id: Generated<string>;
  tenant_id: string;
  session_id: string;
  token_hash: string;
  created_at: Generated<Timestamp>;
  consumed_at: NullableTimestamp;
}

/**
 * Platform-global (no RLS): OIDC login-initiation records, keyed by an
 * unguessable single-use state. See migrations/005_oidc_initiations.ts.
 */
export interface OidcInitiationsTable {
  state: string;
  nonce: string;
  code_verifier: string;
  tenant_id: string;
  created_at: Generated<Timestamp>;
  expires_at: Timestamp;
}

export interface Database {
  tenants: TenantsTable;
  agents: AgentsTable;
  users: UsersTable;
  sessions: SessionsTable;
  refresh_tokens: RefreshTokensTable;
  oidc_initiations: OidcInitiationsTable;
}
