import { type Kysely, sql } from "kysely";

/**
 * Per-operator dismiss-until-change state for derived Attention follow-ups.
 *
 * Not an inbox, notification history, or delivery receipt store. Operators
 * dismiss a surfaced item keyed by finding + attention kind + condition
 * watermark; the item reappears only when the derived condition advances
 * (item.at > condition_at) or the attention kind class changes.
 *
 * Applies to finding.needs_revisit / finding.reminder_due /
 * finding.action_needed only. Change-feed items remain cursor-based.
 *
 * Deferred: inbox, preferences, rich history, external delivery, live updates.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table finding_attention_dismissals (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id),
      user_id uuid not null,
      finding_id uuid not null,
      kind text not null,
      condition_at timestamptz not null,
      dismissed_at timestamptz not null default now(),
      unique (tenant_id, user_id, finding_id, kind),
      constraint finding_attention_dismissals_kind_check
        check (
          kind in (
            'finding.needs_revisit',
            'finding.reminder_due',
            'finding.action_needed'
          )
        )
    )
  `.execute(db);

  await sql`
    create index finding_attention_dismissals_tenant_user_idx
      on finding_attention_dismissals (tenant_id, user_id)
  `.execute(db);

  await sql`alter table finding_attention_dismissals enable row level security`.execute(
    db,
  );
  await sql`alter table finding_attention_dismissals force row level security`.execute(
    db,
  );

  await sql`
    create policy finding_attention_dismissals_tenant_isolation
      on finding_attention_dismissals
      using (tenant_id = current_tenant_id())
      with check (tenant_id = current_tenant_id())
  `.execute(db);

  await sql`
    grant select, insert, update on finding_attention_dismissals to depp_app
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists finding_attention_dismissals`.execute(db);
}
