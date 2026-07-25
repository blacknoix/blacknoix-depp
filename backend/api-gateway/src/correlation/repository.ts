import type { Kysely } from "kysely";

import type { Database } from "../db/schema";
import { withTenantTransaction } from "../db/tenant-context";
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
  };
}
