/**
 * Tenant default Work view — references an existing shared Work view.
 *
 * One row per tenant. Deleting the referenced shared view clears the default
 * (ON DELETE CASCADE). Not a preferences center or admin RBAC system.
 */
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table work_tenant_defaults (
      tenant_id uuid primary key references tenants (id),
      default_view_id uuid not null,
      set_at timestamptz not null default now(),
      set_by_user_id uuid,
      constraint work_tenant_defaults_view_fk
        foreign key (tenant_id, default_view_id)
        references work_shared_views (tenant_id, id)
        on delete cascade
    )
  `.execute(db);

  await sql`alter table work_tenant_defaults enable row level security`.execute(
    db,
  );
  await sql`alter table work_tenant_defaults force row level security`.execute(
    db,
  );

  await sql`
    create policy work_tenant_defaults_tenant_isolation on work_tenant_defaults
      using (tenant_id = current_tenant_id())
      with check (tenant_id = current_tenant_id())
  `.execute(db);

  await sql`
    grant select, insert, update, delete on work_tenant_defaults to depp_app
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists work_tenant_defaults`.execute(db);
}
