import { type Kysely, sql } from "kysely";

/**
 * Agent credential foundation (ADR-0003 §5).
 *
 * Agents already exist as tenant-owned identity rows (migration 001). This
 * migration adds the hashed long-lived credential used after enrollment.
 *
 * Flow in this slice (minimal):
 *   1. Trusted tenant principal registers an agent → plaintext credential once.
 *   2. Agent exchanges credential for a short-lived access JWT (tid + aid).
 *   3. Telemetry ingest authenticates with that JWT; revocation blocks exchange.
 *
 * Deferred: separate short-lived enrollment-token table / agent-side redeem UX,
 * mTLS, credential rotation UX, access-token denylist.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table agent_credentials (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id),
      agent_id uuid not null,
      credential_hash text not null,
      created_at timestamptz not null default now(),
      revoked_at timestamptz,
      constraint agent_credentials_agent_fk
        foreign key (tenant_id, agent_id) references agents (tenant_id, id),
      unique (tenant_id, id),
      unique (credential_hash)
    )
  `.execute(db);

  // At most one active (non-revoked) credential per agent in v1.
  await sql`
    create unique index agent_credentials_one_active_idx
      on agent_credentials (tenant_id, agent_id)
      where revoked_at is null
  `.execute(db);

  await sql`
    create index agent_credentials_agent_id_idx
      on agent_credentials (agent_id)
  `.execute(db);

  await sql`alter table agent_credentials enable row level security`.execute(db);
  await sql`alter table agent_credentials force row level security`.execute(db);

  await sql`
    create policy agent_credentials_tenant_isolation on agent_credentials
      using (tenant_id = current_tenant_id())
      with check (tenant_id = current_tenant_id())
  `.execute(db);

  await sql`
    grant select, insert, update on agent_credentials to depp_app
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists agent_credentials`.execute(db);
}
