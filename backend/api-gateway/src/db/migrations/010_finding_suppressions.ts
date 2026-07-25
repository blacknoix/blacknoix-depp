import { type Kysely, sql } from "kysely";

/**
 * Finding suppressions (snooze) v1 — time-bounded mute for a rule within a
 * tenant. Active windows cause correlation evaluation to skip creating new
 * findings for that rule; existing findings are unchanged.
 *
 * Scope: (tenant_id, rule_id) only. Permanent mute, per-agent policy, and
 * bulk workflows are deferred.
 *
 * At most one uncleared row per (tenant_id, rule_id). Creating a new snooze
 * while one is uncleared fails closed at the unique index; callers should
 * clear first or the service replaces via clear+insert.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table finding_suppressions (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id),
      rule_id text not null,
      starts_at timestamptz not null,
      ends_at timestamptz not null,
      created_at timestamptz not null default now(),
      created_by_user_id uuid,
      cleared_at timestamptz,
      cleared_by_user_id uuid,
      unique (tenant_id, id),
      constraint finding_suppressions_window_check
        check (ends_at > starts_at)
    )
  `.execute(db);

  // One uncleared snooze per tenant+rule (cleared rows free the slot).
  await sql`
    create unique index finding_suppressions_one_active_idx
      on finding_suppressions (tenant_id, rule_id)
      where cleared_at is null
  `.execute(db);

  await sql`
    create index finding_suppressions_tenant_active_idx
      on finding_suppressions (tenant_id, ends_at)
      where cleared_at is null
  `.execute(db);

  await sql`alter table finding_suppressions enable row level security`.execute(
    db,
  );
  await sql`alter table finding_suppressions force row level security`.execute(
    db,
  );

  await sql`
    create policy finding_suppressions_tenant_isolation on finding_suppressions
      using (tenant_id = current_tenant_id())
      with check (tenant_id = current_tenant_id())
  `.execute(db);

  await sql`
    grant select, insert, update on finding_suppressions to depp_app
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists finding_suppressions`.execute(db);
}
