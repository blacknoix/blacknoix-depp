import { type Kysely, sql } from "kysely";

/**
 * Correlation findings v1 — tenant-scoped, append-oriented detection output.
 *
 * ADR-0001 lists "alerts" as a tenant-owned entity. This table is the minimal
 * persistence for deterministic post-ingest rules over telemetry v1 signals
 * (heartbeat, agent.started, agent.stopped). It is deliberately not a full
 * alert console (no ack/status/triage workflow).
 *
 * Dedup: unique (tenant_id, agent_id, rule_id, window_bucket) so re-evaluation
 * within the same time bucket does not spam identical findings.
 *
 * Deferred: silence/missing-heartbeat (needs a scheduler), rule DSL, queues,
 * remediation, finding lifecycle/ack, malware signals.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table correlation_findings (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id),
      agent_id uuid not null,
      rule_id text not null,
      title text not null,
      severity text not null,
      evidence jsonb not null default '{}'::jsonb,
      window_start timestamptz not null,
      window_end timestamptz not null,
      window_bucket timestamptz not null,
      created_at timestamptz not null default now(),
      constraint correlation_findings_agent_fk
        foreign key (tenant_id, agent_id) references agents (tenant_id, id),
      constraint correlation_findings_severity_check
        check (severity in ('low', 'medium', 'high')),
      unique (tenant_id, id),
      unique (tenant_id, agent_id, rule_id, window_bucket)
    )
  `.execute(db);

  await sql`
    create index correlation_findings_tenant_created_idx
      on correlation_findings (tenant_id, created_at desc)
  `.execute(db);

  await sql`
    create index correlation_findings_tenant_agent_created_idx
      on correlation_findings (tenant_id, agent_id, created_at desc)
  `.execute(db);

  await sql`alter table correlation_findings enable row level security`.execute(
    db,
  );
  await sql`alter table correlation_findings force row level security`.execute(
    db,
  );

  await sql`
    create policy correlation_findings_tenant_isolation on correlation_findings
      using (tenant_id = current_tenant_id())
      with check (tenant_id = current_tenant_id())
  `.execute(db);

  await sql`
    grant select, insert on correlation_findings to depp_app
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists correlation_findings`.execute(db);
}
