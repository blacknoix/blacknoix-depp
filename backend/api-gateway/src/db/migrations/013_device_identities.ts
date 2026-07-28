import { type Kysely, sql } from "kysely";

/**
 * Device identities (TRD bridge) — Ed25519 public keys bound to enrolled agents.
 *
 * NODEENROLL / device cert issuance is deferred. This table is the substrate
 * for signed THREATEVENT envelopes. status=active is required for submit.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table device_identities (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id),
      agent_id uuid not null,
      public_key_ed25519 text not null,
      device_cert_pem text,
      status text not null default 'pending',
      created_at timestamptz not null default now(),
      revoked_at timestamptz,
      constraint device_identities_agent_fk
        foreign key (tenant_id, agent_id) references agents (tenant_id, id),
      constraint device_identities_status_check
        check (status in ('pending', 'active', 'revoked')),
      unique (tenant_id, id),
      unique (tenant_id, agent_id),
      unique (tenant_id, public_key_ed25519)
    )
  `.execute(db);

  await sql`
    create index device_identities_tenant_agent_idx
      on device_identities (tenant_id, agent_id)
  `.execute(db);

  await sql`alter table device_identities enable row level security`.execute(db);
  await sql`alter table device_identities force row level security`.execute(db);

  await sql`
    create policy device_identities_tenant_isolation on device_identities
      using (tenant_id = current_tenant_id())
      with check (tenant_id = current_tenant_id())
  `.execute(db);

  await sql`
    grant select, insert, update on device_identities to depp_app
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists device_identities`.execute(db);
}
