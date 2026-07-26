import type { Kysely } from "kysely";
import { sql } from "kysely";

import type { Database } from "../db/schema";
import { withTenantTransaction } from "../db/tenant-context";
import type { AttentionItem } from "./attention";
import type { FindingsDashboardRawCounts } from "./dashboard";
import type { FindingStatus } from "./lifecycle";
import type { CorrelationRuleId, FindingSeverity } from "./rules";

export interface CorrelationFindingInsert {
  agentId: string;
  ruleId: CorrelationRuleId;
  title: string;
  severity: FindingSeverity;
  evidence: Record<string, unknown>;
  windowStart: Date;
  windowEnd: Date;
  windowBucket: Date;
}

export interface CorrelationFindingRow {
  id: string;
  tenantId: string;
  agentId: string;
  ruleId: string;
  title: string;
  severity: string;
  evidence: Record<string, unknown>;
  windowStart: Date;
  windowEnd: Date;
  windowBucket: Date;
  createdAt: Date;
  status: FindingStatus;
  statusChangedAt: Date | null;
  statusChangedByUserId: string | null;
}

export interface ListFindingsQuery {
  agentId?: string;
  ruleId?: CorrelationRuleId;
  status?: FindingStatus;
  limit: number;
  offset: number;
}

export interface UpdateFindingStatusInput {
  status: FindingStatus;
  changedAt: Date;
  changedByUserId: string | null;
}

export interface CorrelationFindingsRepository {
  /**
   * Inserts a finding; same-bucket duplicates are ignored (dedup).
   * Returns the row id when inserted, undefined when suppressed.
   * New findings are always status=open.
   */
  insertFindingIgnoreDup(
    tenantId: string,
    finding: CorrelationFindingInsert,
  ): Promise<string | undefined>;

  listFindings(
    tenantId: string,
    query: ListFindingsQuery,
  ): Promise<CorrelationFindingRow[]>;

  getFindingById(
    tenantId: string,
    findingId: string,
  ): Promise<CorrelationFindingRow | undefined>;

  updateFindingStatus(
    tenantId: string,
    findingId: string,
    update: UpdateFindingStatusInput,
  ): Promise<CorrelationFindingRow | undefined>;

  /**
   * Compact operator dashboard aggregates for one tenant.
   * Caller supplies `since` (typically now − 24h) and `at` (evaluation now).
   * Suppression active count is included so ops can see snooze coverage
   * without a second round-trip.
   */
  getDashboardRawCounts(
    tenantId: string,
    since: Date,
    at: Date,
  ): Promise<FindingsDashboardRawCounts>;

  /**
   * Pull-based attention sources for the operator digest.
   * `limit` applies per source (created / status-changed).
   */
  getAttentionRawSources(
    tenantId: string,
    since: Date,
    at: Date,
    limit: number,
  ): Promise<{
    created: AttentionItem[];
    statusChanged: AttentionItem[];
    openCount: number;
    activeSuppressionCount: number;
  }>;
}

function asDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    return new Date(value);
  }
  throw new Error("expected a timestamp value");
}

function asEvidence(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asStatus(value: unknown): FindingStatus {
  if (value === "open" || value === "acknowledged" || value === "resolved") {
    return value;
  }
  throw new Error(`unexpected finding status: ${String(value)}`);
}

function mapRow(row: {
  id: string;
  tenant_id: string;
  agent_id: string;
  rule_id: string;
  title: string;
  severity: string;
  evidence: unknown;
  window_start: unknown;
  window_end: unknown;
  window_bucket: unknown;
  created_at: unknown;
  status: string;
  status_changed_at: unknown;
  status_changed_by_user_id: string | null;
}): CorrelationFindingRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    ruleId: row.rule_id,
    title: row.title,
    severity: row.severity,
    evidence: asEvidence(row.evidence),
    windowStart: asDate(row.window_start),
    windowEnd: asDate(row.window_end),
    windowBucket: asDate(row.window_bucket),
    createdAt: asDate(row.created_at),
    status: asStatus(row.status),
    statusChangedAt: row.status_changed_at
      ? asDate(row.status_changed_at)
      : null,
    statusChangedByUserId: row.status_changed_by_user_id,
  };
}

export function createCorrelationFindingsRepository(
  db: Kysely<Database>,
): CorrelationFindingsRepository {
  return {
    async insertFindingIgnoreDup(tenantId, finding) {
      return withTenantTransaction(db, tenantId, async (trx) => {
        const row = await trx
          .insertInto("correlation_findings")
          .values({
            tenant_id: tenantId,
            agent_id: finding.agentId,
            rule_id: finding.ruleId,
            title: finding.title,
            severity: finding.severity,
            evidence: finding.evidence,
            window_start: finding.windowStart,
            window_end: finding.windowEnd,
            window_bucket: finding.windowBucket,
            status: "open",
          })
          .onConflict((oc) =>
            oc
              .columns(["tenant_id", "agent_id", "rule_id", "window_bucket"])
              .doNothing(),
          )
          .returning("id")
          .executeTakeFirst();

        return row?.id;
      });
    },

    async listFindings(tenantId, query) {
      return withTenantTransaction(db, tenantId, async (trx) => {
        let listQuery = trx
          .selectFrom("correlation_findings")
          .selectAll()
          .orderBy("created_at", "desc")
          .limit(query.limit)
          .offset(query.offset);

        if (query.agentId) {
          listQuery = listQuery.where("agent_id", "=", query.agentId);
        }
        if (query.ruleId) {
          listQuery = listQuery.where("rule_id", "=", query.ruleId);
        }
        if (query.status) {
          listQuery = listQuery.where("status", "=", query.status);
        }

        const rows = await listQuery.execute();
        return rows.map(mapRow);
      });
    },

    async getFindingById(tenantId, findingId) {
      return withTenantTransaction(db, tenantId, async (trx) => {
        const row = await trx
          .selectFrom("correlation_findings")
          .selectAll()
          .where("id", "=", findingId)
          .executeTakeFirst();

        return row ? mapRow(row) : undefined;
      });
    },

    async updateFindingStatus(tenantId, findingId, update) {
      return withTenantTransaction(db, tenantId, async (trx) => {
        const row = await trx
          .updateTable("correlation_findings")
          .set({
            status: update.status,
            status_changed_at: update.changedAt,
            status_changed_by_user_id: update.changedByUserId,
          })
          .where("id", "=", findingId)
          .returningAll()
          .executeTakeFirst();

        return row ? mapRow(row) : undefined;
      });
    },

    async getDashboardRawCounts(tenantId, since, at) {
      return withTenantTransaction(db, tenantId, async (trx) => {
        const statusRows = await trx
          .selectFrom("correlation_findings")
          .select(["status", (eb) => eb.fn.countAll<string>().as("count")])
          .groupBy("status")
          .execute();

        const ruleRows = await trx
          .selectFrom("correlation_findings")
          .select(["rule_id", (eb) => eb.fn.countAll<string>().as("count")])
          .groupBy("rule_id")
          .execute();

        const recentCreated = await trx
          .selectFrom("correlation_findings")
          .select((eb) => eb.fn.countAll<string>().as("count"))
          .where(sql<boolean>`created_at >= ${since}`)
          .executeTakeFirstOrThrow();

        const recentChanged = await trx
          .selectFrom("correlation_findings")
          .select((eb) => eb.fn.countAll<string>().as("count"))
          .where(sql<boolean>`status_changed_at is not null`)
          .where(sql<boolean>`status_changed_at >= ${since}`)
          .executeTakeFirstOrThrow();

        const activeSuppressions = await trx
          .selectFrom("finding_suppressions")
          .select((eb) => eb.fn.countAll<string>().as("count"))
          .where("cleared_at", "is", null)
          .where(sql<boolean>`starts_at <= ${at}`)
          .where(sql<boolean>`ends_at > ${at}`)
          .executeTakeFirstOrThrow();

        return {
          statusCounts: statusRows.map((row) => ({
            status: row.status,
            count: Number(row.count),
          })),
          ruleCounts: ruleRows.map((row) => ({
            ruleId: row.rule_id,
            count: Number(row.count),
          })),
          recentCreatedCount: Number(recentCreated.count),
          recentChangedCount: Number(recentChanged.count),
          activeSuppressionCount: Number(activeSuppressions.count),
        };
      });
    },

    async getAttentionRawSources(tenantId, since, at, limit) {
      return withTenantTransaction(db, tenantId, async (trx) => {
        const createdRows = await trx
          .selectFrom("correlation_findings")
          .selectAll()
          .where(sql<boolean>`created_at >= ${since}`)
          .orderBy("created_at", "desc")
          .limit(limit)
          .execute();

        const changedRows = await trx
          .selectFrom("correlation_findings")
          .selectAll()
          .where(sql<boolean>`status_changed_at is not null`)
          .where(sql<boolean>`status_changed_at >= ${since}`)
          .orderBy("status_changed_at", "desc")
          .limit(limit)
          .execute();

        const openRow = await trx
          .selectFrom("correlation_findings")
          .select((eb) => eb.fn.countAll<string>().as("count"))
          .where("status", "=", "open")
          .executeTakeFirstOrThrow();

        const activeSuppressions = await trx
          .selectFrom("finding_suppressions")
          .select((eb) => eb.fn.countAll<string>().as("count"))
          .where("cleared_at", "is", null)
          .where(sql<boolean>`starts_at <= ${at}`)
          .where(sql<boolean>`ends_at > ${at}`)
          .executeTakeFirstOrThrow();

        return {
          created: createdRows.map((row) => {
            const mapped = mapRow(row);
            return {
              kind: "finding.created" as const,
              findingId: mapped.id,
              title: mapped.title,
              status: mapped.status,
              ruleId: mapped.ruleId,
              agentId: mapped.agentId,
              at: mapped.createdAt,
            };
          }),
          statusChanged: changedRows.map((row) => {
            const mapped = mapRow(row);
            return {
              kind: "finding.status_changed" as const,
              findingId: mapped.id,
              title: mapped.title,
              status: mapped.status,
              ruleId: mapped.ruleId,
              agentId: mapped.agentId,
              at: mapped.statusChangedAt!,
            };
          }),
          openCount: Number(openRow.count),
          activeSuppressionCount: Number(activeSuppressions.count),
        };
      });
    },
  };
}
