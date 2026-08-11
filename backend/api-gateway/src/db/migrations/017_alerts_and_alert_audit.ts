import { type Kysely, sql } from "kysely";

/**
 * telemetry-to-auditable-alert-v1: tenant-owned alerts + append-only audit.
 *
 * Separate from correlation_findings / findings HTTP. Dedup via unique
 * (tenant_id, agent_id, rule_id, window_bucket). alert_audit_events is
 * INSERT+SELECT only for depp_app (no UPDATE/DELETE).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table alerts (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id),
      agent_id uuid not null,
      rule_id text not null,
      window_bucket timestamptz not null,
      window_start timestamptz not null,
      window_end timestamptz not null,
      contributing_count integer not null,
      contributing_event_ids uuid[] not null,
      created_at timestamptz not null default now(),
      constraint alerts_agent_fk
        foreign key (tenant_id, agent_id) references agents (tenant_id, id),
      constraint alerts_contributing_count_check
        check (contributing_count >= 0),
      unique (tenant_id, id),
      unique (tenant_id, agent_id, rule_id, window_bucket)
    )
  `.execute(db);

  await sql`
    create index alerts_tenant_created_idx
      on alerts (tenant_id, created_at desc)
  `.execute(db);

  await sql`
    create index alerts_tenant_agent_created_idx
      on alerts (tenant_id, agent_id, created_at desc)
  `.execute(db);

  await sql`alter table alerts enable row level security`.execute(db);
  await sql`alter table alerts force row level security`.execute(db);

  await sql`
    create policy alerts_tenant_isolation on alerts
      using (tenant_id = current_tenant_id())
      with check (tenant_id = current_tenant_id())
  `.execute(db);

  await sql`grant select, insert on alerts to depp_app`.execute(db);

  await sql`
    create table alert_audit_events (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id),
      alert_id uuid not null,
      event_type text not null,
      occurred_at timestamptz not null default now(),
      actor_kind text not null,
      actor_id text null,
      detail jsonb not null default '{}'::jsonb,
      constraint alert_audit_events_alert_fk
        foreign key (tenant_id, alert_id) references alerts (tenant_id, id),
      unique (tenant_id, id)
    )
  `.execute(db);

  await sql`
    create index alert_audit_events_tenant_alert_idx
      on alert_audit_events (tenant_id, alert_id, occurred_at desc)
  `.execute(db);

  await sql`alter table alert_audit_events enable row level security`.execute(
    db,
  );
  await sql`alter table alert_audit_events force row level security`.execute(
    db,
  );

  await sql`
    create policy alert_audit_events_tenant_isolation on alert_audit_events
      using (tenant_id = current_tenant_id())
      with check (tenant_id = current_tenant_id())
  `.execute(db);

  // Append-only: no UPDATE/DELETE for the application role.
  await sql`
    grant select, insert on alert_audit_events to depp_app
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists alert_audit_events`.execute(db);
  await sql`drop table if exists alerts`.execute(db);
}
