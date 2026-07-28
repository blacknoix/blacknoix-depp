import { type Kysely, sql } from "kysely";

/**
 * ADR-0005: persist detection provenance on correlation_findings.
 *
 * New writes use bridge_correlation | agent_signed only.
 * Existing rows get legacy_unspecified via column DEFAULT (no row UPDATE —
 * FORCE RLS would fail migrate without app.current_tenant).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table correlation_findings
      add column detection_source text not null default 'legacy_unspecified'
  `.execute(db);

  await sql`
    alter table correlation_findings
      add constraint correlation_findings_detection_source_check
      check (
        detection_source in (
          'bridge_correlation',
          'agent_signed',
          'legacy_unspecified'
        )
      )
  `.execute(db);

  // New inserts must supply detection_source explicitly from the app.
  await sql`
    alter table correlation_findings
      alter column detection_source drop default
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table correlation_findings
      drop constraint if exists correlation_findings_detection_source_check
  `.execute(db);
  await sql`
    alter table correlation_findings
      drop column if exists detection_source
  `.execute(db);
}
