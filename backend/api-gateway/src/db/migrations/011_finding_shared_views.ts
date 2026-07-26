import { type Kysely, sql } from "kysely";

/**
 * Tenant-scoped shared Findings views (operator product).
 *
 * Stores only filter dimensions: status / rule_id / agent_id (nullable).
 * findingId selection is never persisted. Local browser views remain separate.
 *
 * Deferred: folders, favorites, comments, rich RBAC, rename-only endpoint.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table finding_shared_views (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id),
      name text not null,
      status text,
      rule_id text,
      agent_id uuid,
      created_at timestamptz not null default now(),
      created_by_user_id uuid,
      unique (tenant_id, id),
      constraint finding_shared_views_name_len_check
        check (char_length(name) between 1 and 40),
      constraint finding_shared_views_status_check
        check (
          status is null
          or status in ('open', 'acknowledged', 'resolved')
        )
    )
  `.execute(db);

  await sql`
    create unique index finding_shared_views_tenant_name_idx
      on finding_shared_views (tenant_id, lower(name))
  `.execute(db);

  await sql`
    create index finding_shared_views_tenant_created_idx
      on finding_shared_views (tenant_id, created_at desc)
  `.execute(db);

  await sql`alter table finding_shared_views enable row level security`.execute(
    db,
  );
  await sql`alter table finding_shared_views force row level security`.execute(
    db,
  );

  await sql`
    create policy finding_shared_views_tenant_isolation on finding_shared_views
      using (tenant_id = current_tenant_id())
      with check (tenant_id = current_tenant_id())
  `.execute(db);

  await sql`
    grant select, insert, delete on finding_shared_views to depp_app
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists finding_shared_views`.execute(db);
}
