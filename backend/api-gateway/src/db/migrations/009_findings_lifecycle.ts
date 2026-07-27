import { type Kysely, sql } from "kysely";

/**
 * Findings lifecycle v1 — minimal triage status on correlation_findings.
 *
 * States: open | acknowledged | resolved. Default open on insert.
 * Last-change audit only (status_changed_at / status_changed_by_user_id).
 *
 * status_changed_by_user_id is a soft reference to users.id (no composite FK):
 * adding a FK to users during migrate would SELECT under FORCE RLS without a
 * tenant GUC and fail closed. The app only writes principal.userId (JWT) or null.
 *
 * Deferred: status history table, comments, assignment, snooze.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table correlation_findings
      add column if not exists status text not null default 'open',
      add column if not exists status_changed_at timestamptz,
      add column if not exists status_changed_by_user_id uuid
  `.execute(db);

  await sql`
    do $$
    begin
      if not exists (
        select 1 from pg_constraint
        where conname = 'correlation_findings_status_check'
      ) then
        alter table correlation_findings
          add constraint correlation_findings_status_check
            check (status in ('open', 'acknowledged', 'resolved'));
      end if;
    end $$
  `.execute(db);

  await sql`
    create index if not exists correlation_findings_tenant_status_created_idx
      on correlation_findings (tenant_id, status, created_at desc)
  `.execute(db);

  await sql`
    grant select, insert, update on correlation_findings to depp_app
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop index if exists correlation_findings_tenant_status_created_idx
  `.execute(db);

  await sql`
    alter table correlation_findings
      drop constraint if exists correlation_findings_status_check,
      drop column if exists status_changed_by_user_id,
      drop column if exists status_changed_at,
      drop column if exists status
  `.execute(db);

  await sql`revoke update on correlation_findings from depp_app`.execute(db);
}
