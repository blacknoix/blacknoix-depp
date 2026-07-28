import { type Kysely, sql } from "kysely";

/**
 * Path-scoped threat_events dedup (ADR-0005 bridge-replacement).
 *
 * Allows one bridge_correlation and one agent_signed threat_event for the same
 * (tenant, agent, rule, window_bucket) so signed correlation can finalize and
 * monotonically upgrade a pre-existing bridge finding. Finding uniqueness is
 * unchanged: still one correlation_findings row per that key.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table threat_events
      add column detection_source text not null default 'legacy_unspecified'
  `.execute(db);

  await sql`
    alter table threat_events
      add constraint threat_events_detection_source_check
      check (
        detection_source in (
          'bridge_correlation',
          'agent_signed',
          'legacy_unspecified'
        )
      )
  `.execute(db);

  // Postgres names the UNIQUE constraint from the create-table column list.
  await sql`
    alter table threat_events
      drop constraint if exists
        threat_events_tenant_id_agent_id_detection_rule_id_window_bucket_key
  `.execute(db);

  await sql`
    alter table threat_events
      add constraint threat_events_path_dedup_key
      unique (
        tenant_id,
        agent_id,
        detection_rule_id,
        window_bucket,
        detection_source
      )
  `.execute(db);

  // New inserts must supply detection_source explicitly from the app.
  await sql`
    alter table threat_events
      alter column detection_source drop default
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table threat_events
      drop constraint if exists threat_events_path_dedup_key
  `.execute(db);

  // Best-effort restore of the pre-016 unique key. Fails if both bridge and
  // signed rows exist for the same window — expected when rolling back after
  // dual-path writes; operators must clear duplicates first.
  await sql`
    alter table threat_events
      add constraint threat_events_tenant_id_agent_id_detection_rule_id_window_bucket_key
      unique (tenant_id, agent_id, detection_rule_id, window_bucket)
  `.execute(db);

  await sql`
    alter table threat_events
      drop constraint if exists threat_events_detection_source_check
  `.execute(db);

  await sql`
    alter table threat_events
      drop column if exists detection_source
  `.execute(db);
}
