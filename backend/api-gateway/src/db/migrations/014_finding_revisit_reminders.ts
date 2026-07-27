import { type Kysely, sql } from "kysely";

/**
 * Tenant-owned explicit revisit reminders for Findings.
 *
 * Reminders are explicit operator-deferred revisit points (not scheduled
 * automation). They are auditable, tenant-isolated, and auto-cleared when a
 * finding is resolved, its ownership changes, or it is touched again before
 * the reminder due time.
 *
 * Deferred: reminder preferences, delivery, recurring reminders, inbox UI.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table finding_revisit_reminders (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id),
      finding_id uuid not null,
      owner_user_id uuid not null,
      remind_at timestamptz not null,
      set_at timestamptz not null default now(),
      set_by_user_id uuid not null,
      cleared_at timestamptz,
      cleared_by_user_id uuid,
      unique (tenant_id, finding_id),
      constraint finding_revisit_reminders_remind_at_check
        check (remind_at is not null)
    )
  `.execute(db);

  await sql`
    create index finding_revisit_reminders_tenant_owner_remind_idx
      on finding_revisit_reminders (tenant_id, owner_user_id, remind_at asc)
      where cleared_at is null
  `.execute(db);

  await sql`alter table finding_revisit_reminders enable row level security`.execute(
    db,
  );
  await sql`alter table finding_revisit_reminders force row level security`.execute(
    db,
  );

  await sql`
    create policy finding_revisit_reminders_tenant_isolation on finding_revisit_reminders
      using (tenant_id = current_tenant_id())
      with check (tenant_id = current_tenant_id())
  `.execute(db);

  await sql`
    grant select, insert, update on finding_revisit_reminders to depp_app
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists finding_revisit_reminders`.execute(db);
}

