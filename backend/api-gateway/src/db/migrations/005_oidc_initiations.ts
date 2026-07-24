import { type Kysely, sql } from "kysely";

/**
 * Shared, HA store for OIDC login-initiation records (ADR-0003 §9 login flow).
 *
 * Platform-global, NOT tenant RLS. The callback looks records up by `state`
 * alone — no tenant context exists at that point — so RLS-by-tenant is
 * structurally inapplicable. Security is the unguessable single-use `state`
 * plus the short TTL, not row-level security. `tenant_id` is a server-owned
 * binding stored with the record and handed to completeOidcLogin, which then
 * does the tenant-scoped work under RLS.
 *
 * `state` is the primary key: it gives the unique index and the row that
 * DELETE ... RETURNING consumes exactly once, even under concurrent callbacks
 * on the same state.
 *
 * DEFERRED (called out, not solved): code_verifier and nonce are stored in
 * plaintext. They are single-use and short-lived, so the residual risk of a
 * database read is small, but at-rest hardening — hashing `state` the way
 * refresh tokens are hashed, and encrypting the verifier/nonce — is a follow-up.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table oidc_initiations (
      state text primary key,
      nonce text not null,
      code_verifier text not null,
      tenant_id uuid not null references tenants (id),
      created_at timestamptz not null default now(),
      expires_at timestamptz not null
    )
  `.execute(db);

  // Supports the expired-row cleanup helper.
  await sql`create index oidc_initiations_expires_at_idx on oidc_initiations (expires_at)`.execute(db);

  // The app role inserts (start), deletes (consume + cleanup), and reads via
  // DELETE ... RETURNING. No RLS is enabled on this table.
  await sql`grant select, insert, delete on oidc_initiations to depp_app`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists oidc_initiations`.execute(db);
}
