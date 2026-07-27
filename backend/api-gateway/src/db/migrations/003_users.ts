import { type Kysely, sql } from "kysely";

/**
 * User/identity foundation for federated login (ADR-0003 §9).
 *
 * Every authenticated human maps to a row here. The canonical identity key is
 * (issuer, subject) from the IdP token — email is mutable and reassignable, so
 * it is cached for presentation only and is never an identity key. The
 * DEPP-generated id is the stable anchor that sessions, refresh tokens, and
 * role grants will reference.
 *
 * Same RLS treatment as agents: ENABLE + FORCE, USING + WITH CHECK through
 * current_tenant_id(), so the app role can only ever touch users of the tenant
 * in the current transaction context, and an unscoped query fails closed.
 *
 * The app role gets no DELETE: nothing in the product deletes users yet, and
 * user removal will be a deliberate admin flow with its own audit trail.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table users (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id),
      issuer text not null,
      subject text not null,
      email text,
      display_name text,
      created_at timestamptz not null default now(),
      unique (tenant_id, issuer, subject)
    )
  `.execute(db);

  await sql`create index users_tenant_id_idx on users (tenant_id)`.execute(db);

  await sql`alter table users enable row level security`.execute(db);
  await sql`alter table users force row level security`.execute(db);

  await sql`
    create policy users_tenant_isolation on users
      using (tenant_id = current_tenant_id())
      with check (tenant_id = current_tenant_id())
  `.execute(db);

  await sql`grant select, insert, update on users to depp_app`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists users`.execute(db);
}
