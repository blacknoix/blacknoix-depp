import { type Kysely, sql } from "kysely";

/**
 * Threat events (TRD bridge) — canonical signed THREATEVENT persistence.
 *
 * Finality states: pending → finalized | rejected | analyst_review (no reverse).
 * Operator-visible findings are materialized only after finality succeeds.
 *
 * Real CometBFT / libp2p / Ed25519 crypto verify are deferred; this migration
 * is the persistence contract those seams will use.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table threat_events (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id),
      agent_id uuid not null,
      device_identity_id uuid not null,
      detection_rule_id text not null,
      title text not null,
      severity text not null,
      evidence jsonb not null default '{}'::jsonb,
      window_start timestamptz not null,
      window_end timestamptz not null,
      window_bucket timestamptz not null,
      occurred_at timestamptz not null,
      signature text not null,
      signed_at timestamptz not null,
      finality_state text not null default 'pending',
      finality_reason text,
      finalized_at timestamptz,
      finding_id uuid,
      created_at timestamptz not null default now(),
      constraint threat_events_agent_fk
        foreign key (tenant_id, agent_id) references agents (tenant_id, id),
      constraint threat_events_device_identity_fk
        foreign key (tenant_id, device_identity_id)
          references device_identities (tenant_id, id),
      constraint threat_events_severity_check
        check (severity in ('low', 'medium', 'high')),
      constraint threat_events_finality_state_check
        check (
          finality_state in (
            'pending',
            'finalized',
            'rejected',
            'analyst_review'
          )
        ),
      unique (tenant_id, id),
      unique (tenant_id, agent_id, detection_rule_id, window_bucket)
    )
  `.execute(db);

  await sql`
    create index threat_events_tenant_created_idx
      on threat_events (tenant_id, created_at desc)
  `.execute(db);

  await sql`
    create index threat_events_tenant_finality_idx
      on threat_events (tenant_id, finality_state, created_at desc)
  `.execute(db);

  await sql`alter table threat_events enable row level security`.execute(db);
  await sql`alter table threat_events force row level security`.execute(db);

  await sql`
    create policy threat_events_tenant_isolation on threat_events
      using (tenant_id = current_tenant_id())
      with check (tenant_id = current_tenant_id())
  `.execute(db);

  await sql`
    grant select, insert, update on threat_events to depp_app
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists threat_events`.execute(db);
}
