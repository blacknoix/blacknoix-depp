import { type Kysely, sql } from "kysely";

/**
 * Findings investigation intent v1 — minimal ownership + current operator note.
 *
 * Ownership is self-claim only (owner_user_id). Soft UUID refs (no FK to users)
 * match status_changed_by_user_id — FORCE RLS blocks migrate-time FK checks.
 *
 * operator_note is a single current plain-text conclusion (not a thread).
 *
 * Deferred: threaded comments, assign-to-others / queues, notifications,
 * separate case entities, attachments, rich text, live updates.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table correlation_findings
      add column if not exists owner_user_id uuid,
      add column if not exists owner_changed_at timestamptz,
      add column if not exists owner_changed_by_user_id uuid,
      add column if not exists operator_note text,
      add column if not exists operator_note_updated_at timestamptz,
      add column if not exists operator_note_updated_by_user_id uuid
  `.execute(db);

  await sql`
    do $$
    begin
      if not exists (
        select 1 from pg_constraint
        where conname = 'correlation_findings_operator_note_len_check'
      ) then
        alter table correlation_findings
          add constraint correlation_findings_operator_note_len_check
            check (
              operator_note is null
              or char_length(operator_note) between 1 and 2000
            );
      end if;
    end $$
  `.execute(db);

  await sql`
    create index if not exists correlation_findings_tenant_owner_created_idx
      on correlation_findings (tenant_id, owner_user_id, created_at desc)
      where owner_user_id is not null
  `.execute(db);

  await sql`
    grant select, insert, update on correlation_findings to depp_app
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop index if exists correlation_findings_tenant_owner_created_idx
  `.execute(db);

  await sql`
    alter table correlation_findings
      drop constraint if exists correlation_findings_operator_note_len_check,
      drop column if exists operator_note_updated_by_user_id,
      drop column if exists operator_note_updated_at,
      drop column if exists operator_note,
      drop column if exists owner_changed_by_user_id,
      drop column if exists owner_changed_at,
      drop column if exists owner_user_id
  `.execute(db);
}
