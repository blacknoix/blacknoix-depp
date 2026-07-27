import { type Kysely, sql } from "kysely";

/**
 * First schema migration: the tenant registry and the first tenant-owned table,
 * with Row-Level Security enforced per ADR-0001 and ADR-0004.
 *
 * Written as raw SQL throughout. The security-critical objects — the tenant
 * resolver, FORCE RLS, the policy, and the grants — must be raw regardless, and
 * keeping the table DDL raw too makes the whole migration reviewable as one
 * piece of SQL.
 *
 * Runs as depp_migrator, which therefore owns every object. depp_app is granted
 * only DML and EXECUTE and never owns anything, so RLS applies to it.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // Resolves the current tenant from the request-scoped GUC, raising a clear
  // error when no tenant context is set.
  //
  // Why a function instead of current_setting('app.current_tenant')::uuid
  // inline: a custom GUC, once set by any transaction on a pooled backend
  // connection, stays *defined* for that session and reverts to an empty string
  // (not "unset") when a transaction-local SET LOCAL ends. The one-argument
  // current_setting therefore stops raising and returns '', which then explodes
  // as ''::uuid with a misleading message. The missing_ok form returns NULL for
  // a never-set GUC and '' for a reset one; this function treats both as "no
  // tenant context" and fails closed with an explicit, honest error.
  await sql`
    create function current_tenant_id() returns uuid
      language plpgsql
      stable
    as $$
    declare
      v_tenant text := current_setting('app.current_tenant', true);
    begin
      if v_tenant is null or v_tenant = '' then
        raise exception 'app.current_tenant is not set'
          using errcode = '22023';
      end if;

      return v_tenant::uuid;
    end;
    $$
  `.execute(db);

  await sql`grant execute on function current_tenant_id() to depp_app`.execute(db);

  // Platform-global registry. No RLS (ADR-0001 allows truly global tables to
  // omit tenant scoping). depp_app may read it; only the migrator writes it.
  await sql`
    create table tenants (
      id uuid primary key default gen_random_uuid(),
      slug text not null unique,
      name text not null,
      created_at timestamptz not null default now()
    )
  `.execute(db);

  await sql`grant select on tenants to depp_app`.execute(db);

  // Tenant-owned. Isolation is enforced below by RLS, not by application code.
  await sql`
    create table agents (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id),
      name text not null,
      created_at timestamptz not null default now()
    )
  `.execute(db);

  await sql`create index agents_tenant_id_idx on agents (tenant_id)`.execute(db);

  await sql`alter table agents enable row level security`.execute(db);

  // FORCE so the (non-superuser) owning role is subject to the policy too, not
  // just other roles. Without FORCE the table owner bypasses RLS entirely.
  await sql`alter table agents force row level security`.execute(db);

  // Single ALL policy: USING governs which rows are visible to
  // SELECT/UPDATE/DELETE; WITH CHECK governs the rows INSERT/UPDATE may write,
  // so a caller cannot create or move a row into another tenant. Both sides go
  // through current_tenant_id(), which fails closed when no tenant is set.
  await sql`
    create policy agents_tenant_isolation on agents
      using (tenant_id = current_tenant_id())
      with check (tenant_id = current_tenant_id())
  `.execute(db);

  await sql`grant select, insert, update, delete on agents to depp_app`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Policies and table-level grants drop with their table. agents first,
  // because it references tenants; the resolver last, once no policy uses it.
  await sql`drop table if exists agents`.execute(db);
  await sql`drop table if exists tenants`.execute(db);
  await sql`drop function if exists current_tenant_id()`.execute(db);
}
