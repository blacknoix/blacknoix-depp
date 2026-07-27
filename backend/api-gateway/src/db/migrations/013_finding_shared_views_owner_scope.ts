import { type Kysely, sql } from "kysely";

/**
 * Extend tenant shared Findings views with optional owner_scope.
 *
 * owner_scope is a relative queue semantic (me | none), not a stored user id.
 * ownerScope=me means “the applying operator’s Mine” — identity is required
 * at apply time on the client / list API, not at view storage time.
 *
 * Existing rows remain valid with owner_scope null (no ownership filter).
 *
 * Deferred: remind-me-later, queue automation, cross-product views.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table finding_shared_views
      add column if not exists owner_scope text
  `.execute(db);

  await sql`
    do $$
    begin
      if not exists (
        select 1 from pg_constraint
        where conname = 'finding_shared_views_owner_scope_check'
      ) then
        alter table finding_shared_views
          add constraint finding_shared_views_owner_scope_check
            check (
              owner_scope is null
              or owner_scope in ('me', 'none')
            );
      end if;
    end $$
  `.execute(db);

  await sql`
    grant select, insert, delete on finding_shared_views to depp_app
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table finding_shared_views
      drop constraint if exists finding_shared_views_owner_scope_check,
      drop column if exists owner_scope
  `.execute(db);
}
