import { type Kysely, sql } from "kysely";

/**
 * Scopes the tenant registry so the application role sees only its own row.
 *
 * The tenants table is platform-global (ADR-0001), but the application role
 * should never read the whole registry: /v1/tenants/me returns the caller's own
 * tenant. This adds RLS as the database-enforced layer beneath the application's
 * explicit `where id = ...` scoping (ADR-0001's two-layer model).
 *
 * ENABLE, not FORCE: unlike a tenant-owned table, tenants is administered by the
 * platform. The owning role (depp_migrator) must manage every tenant, so it is
 * left able to bypass the policy; only the non-owner application role is scoped.
 *
 * Referential integrity checks bypass row security, so the agents -> tenants
 * foreign key established in 001 is unaffected.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table tenants enable row level security`.execute(db);

  await sql`
    create policy tenants_self_read on tenants
      for select
      using (id = current_tenant_id())
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop policy if exists tenants_self_read on tenants`.execute(db);
  await sql`alter table tenants disable row level security`.execute(db);
}
