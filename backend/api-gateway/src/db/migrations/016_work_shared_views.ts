/**
 * Tenant-scoped shared Work views (operator product).
 *
 * Stores only the Work section allowlist. Selection / Attention cursors /
 * findingId are never persisted. Local browser Work views remain separate.
 *
 * Deferred: folders, favorites, comments, rename-only endpoint, cross-product views.
 */
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table work_shared_views (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id),
      name text not null,
      sections text[] not null,
      created_at timestamptz not null default now(),
      created_by_user_id uuid,
      unique (tenant_id, id),
      constraint work_shared_views_name_len_check
        check (char_length(name) between 1 and 40),
      constraint work_shared_views_sections_nonempty_check
        check (cardinality(sections) >= 1)
    )
  `.execute(db);

  await sql`
    create unique index work_shared_views_tenant_name_idx
      on work_shared_views (tenant_id, lower(name))
  `.execute(db);

  await sql`
    create index work_shared_views_tenant_created_idx
      on work_shared_views (tenant_id, created_at desc)
  `.execute(db);

  await sql`alter table work_shared_views enable row level security`.execute(db);
  await sql`alter table work_shared_views force row level security`.execute(db);

  await sql`
    create policy work_shared_views_tenant_isolation on work_shared_views
      using (tenant_id = current_tenant_id())
      with check (tenant_id = current_tenant_id())
  `.execute(db);

  await sql`
    grant select, insert, delete on work_shared_views to depp_app
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists work_shared_views`.execute(db);
}
