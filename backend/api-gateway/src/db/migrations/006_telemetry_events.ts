import { type Kysely, sql } from "kysely";

/**
 * Telemetry events v1 (ADR-0001): append-only, tenant-owned agent signals.
 *
 * Scope of this slice is auth/liveness-oriented events only. Malware detection
 * types, batch ingest, correlation, partitioning, and agent machine-identity
 * auth are deferred. Events are immutable after insert: the app role gets
 * SELECT + INSERT only (no UPDATE/DELETE).
 *
 * Composite FK (tenant_id, agent_id) → agents(tenant_id, id) mirrors sessions →
 * users: RLS WITH CHECK alone cannot prove the referenced agent belongs to the
 * same tenant; the composite key closes that gap.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table agents
      add constraint agents_tenant_id_id_key unique (tenant_id, id)
  `.execute(db);

  await sql`
    create table telemetry_events (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id),
      agent_id uuid not null,
      schema_version integer not null,
      event_type text not null,
      occurred_at timestamptz not null,
      ingested_at timestamptz not null default now(),
      payload jsonb not null default '{}'::jsonb,
      constraint telemetry_events_agent_fk
        foreign key (tenant_id, agent_id) references agents (tenant_id, id),
      unique (tenant_id, id)
    )
  `.execute(db);

  await sql`
    create index telemetry_events_tenant_ingested_idx
      on telemetry_events (tenant_id, ingested_at desc)
  `.execute(db);

  await sql`
    create index telemetry_events_tenant_agent_occurred_idx
      on telemetry_events (tenant_id, agent_id, occurred_at desc)
  `.execute(db);

  await sql`alter table telemetry_events enable row level security`.execute(db);
  await sql`alter table telemetry_events force row level security`.execute(db);

  await sql`
    create policy telemetry_events_tenant_isolation on telemetry_events
      using (tenant_id = current_tenant_id())
      with check (tenant_id = current_tenant_id())
  `.execute(db);

  // Append-only for v1: no update/delete grants.
  await sql`grant select, insert on telemetry_events to depp_app`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists telemetry_events`.execute(db);
  await sql`alter table agents drop constraint if exists agents_tenant_id_id_key`.execute(db);
}
