import { type Kysely, sql } from "kysely";

/**
 * Session and refresh-token foundation for federated login (ADR-0003 §4).
 *
 * This is persistence only: the login flow, JWT issuance, and refresh-token
 * expiry are deferred to the auth-mechanism slice. What lives here is the state
 * that flow will read and write — sessions and one-time-use rotating refresh
 * tokens, each anchored to a users row and isolated by RLS.
 *
 * Refresh tokens are opaque secrets; only their SHA-256 hash is stored, never
 * the plaintext value.
 *
 * Composite foreign keys keep child rows within their tenant at the database
 * level. RLS WITH CHECK validates a row's own tenant_id, but not that a
 * referenced user or session belongs to the same tenant; the composite keys
 * close that gap, so a session can never anchor to another tenant's user.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // Enables (tenant_id, id) to be referenced by composite foreign keys. id is
  // already the primary key, so this is a no-op for data but required for the
  // references below.
  await sql`alter table users add constraint users_tenant_id_id_key unique (tenant_id, id)`.execute(db);

  await sql`
    create table sessions (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id),
      user_id uuid not null,
      created_at timestamptz not null default now(),
      revoked_at timestamptz,
      constraint sessions_user_fk
        foreign key (tenant_id, user_id) references users (tenant_id, id),
      unique (tenant_id, id)
    )
  `.execute(db);

  await sql`create index sessions_user_id_idx on sessions (user_id)`.execute(db);

  await sql`alter table sessions enable row level security`.execute(db);
  await sql`alter table sessions force row level security`.execute(db);
  await sql`
    create policy sessions_tenant_isolation on sessions
      using (tenant_id = current_tenant_id())
      with check (tenant_id = current_tenant_id())
  `.execute(db);
  await sql`grant select, insert, update on sessions to depp_app`.execute(db);

  await sql`
    create table refresh_tokens (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id),
      session_id uuid not null,
      token_hash text not null unique,
      created_at timestamptz not null default now(),
      consumed_at timestamptz,
      constraint refresh_tokens_session_fk
        foreign key (tenant_id, session_id) references sessions (tenant_id, id)
    )
  `.execute(db);

  await sql`create index refresh_tokens_session_id_idx on refresh_tokens (session_id)`.execute(db);

  await sql`alter table refresh_tokens enable row level security`.execute(db);
  await sql`alter table refresh_tokens force row level security`.execute(db);
  await sql`
    create policy refresh_tokens_tenant_isolation on refresh_tokens
      using (tenant_id = current_tenant_id())
      with check (tenant_id = current_tenant_id())
  `.execute(db);
  await sql`grant select, insert, update on refresh_tokens to depp_app`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists refresh_tokens`.execute(db);
  await sql`drop table if exists sessions`.execute(db);
  await sql`alter table users drop constraint if exists users_tenant_id_id_key`.execute(db);
}
