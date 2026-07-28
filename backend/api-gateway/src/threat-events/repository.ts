import type { Kysely } from "kysely";

import type { Database } from "../db/schema";
import { withTenantTransaction } from "../db/tenant-context";
import {
  assertFinalityTransition,
  type FinalityState,
  type ThreatSeverity,
} from "./envelope";

export interface ThreatEventRow {
  id: string;
  tenantId: string;
  agentId: string;
  deviceIdentityId: string;
  detectionRuleId: string;
  title: string;
  severity: ThreatSeverity;
  evidence: Record<string, unknown>;
  windowStart: Date;
  windowEnd: Date;
  windowBucket: Date;
  occurredAt: Date;
  signature: string;
  signedAt: Date;
  finalityState: FinalityState;
  finalityReason: string | null;
  finalizedAt: Date | null;
  findingId: string | null;
  createdAt: Date;
  detectionSource: string;
}

export interface ThreatEventInsert {
  agentId: string;
  deviceIdentityId: string;
  detectionRuleId: string;
  title: string;
  severity: ThreatSeverity;
  evidence: Record<string, unknown>;
  windowStart: Date;
  windowEnd: Date;
  windowBucket: Date;
  occurredAt: Date;
  signature: string;
  signedAt: Date;
  /** Path provenance: scopes threat_events unique key with window_bucket. */
  detectionSource: string;
}

export type InsertThreatEventResult =
  | { ok: true; event: ThreatEventRow }
  | { ok: false; reason: "duplicate" };

export type TransitionFinalityResult =
  | { ok: true; event: ThreatEventRow }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "invalid_transition"; message: string };

export interface ThreatEventsRepository {
  insertPending(
    tenantId: string,
    input: ThreatEventInsert,
  ): Promise<InsertThreatEventResult>;

  getById(
    tenantId: string,
    id: string,
  ): Promise<ThreatEventRow | undefined>;

  transitionFinality(
    tenantId: string,
    id: string,
    to: FinalityState,
    options: {
      reason?: string | null;
      findingId?: string | null;
      at: Date;
    },
  ): Promise<TransitionFinalityResult>;
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

function mapRow(row: {
  id: string;
  tenant_id: string;
  agent_id: string;
  device_identity_id: string;
  detection_rule_id: string;
  title: string;
  severity: string;
  evidence: unknown;
  window_start: unknown;
  window_end: unknown;
  window_bucket: unknown;
  occurred_at: unknown;
  signature: string;
  signed_at: unknown;
  finality_state: string;
  finality_reason: string | null;
  finalized_at: unknown;
  finding_id: string | null;
  created_at: unknown;
  detection_source: string;
}): ThreatEventRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    deviceIdentityId: row.device_identity_id,
    detectionRuleId: row.detection_rule_id,
    title: row.title,
    severity: row.severity as ThreatSeverity,
    evidence: asEvidence(row.evidence),
    windowStart: asDate(row.window_start),
    windowEnd: asDate(row.window_end),
    windowBucket: asDate(row.window_bucket),
    occurredAt: asDate(row.occurred_at),
    signature: row.signature,
    signedAt: asDate(row.signed_at),
    finalityState: row.finality_state as FinalityState,
    finalityReason: row.finality_reason,
    finalizedAt: row.finalized_at ? asDate(row.finalized_at) : null,
    findingId: row.finding_id,
    createdAt: asDate(row.created_at),
    detectionSource: row.detection_source,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

export function createThreatEventsRepository(
  db: Kysely<Database>,
): ThreatEventsRepository {
  return {
    async insertPending(tenantId, input) {
      try {
        return await withTenantTransaction(db, tenantId, async (trx) => {
          const row = await trx
            .insertInto("threat_events")
            .values({
              tenant_id: tenantId,
              agent_id: input.agentId,
              device_identity_id: input.deviceIdentityId,
              detection_rule_id: input.detectionRuleId,
              title: input.title,
              severity: input.severity,
              evidence: input.evidence,
              window_start: input.windowStart,
              window_end: input.windowEnd,
              window_bucket: input.windowBucket,
              occurred_at: input.occurredAt,
              signature: input.signature,
              signed_at: input.signedAt,
              finality_state: "pending",
              detection_source: input.detectionSource,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
          return { ok: true as const, event: mapRow(row) };
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          return { ok: false, reason: "duplicate" };
        }
        throw err;
      }
    },

    async getById(tenantId, id) {
      return withTenantTransaction(db, tenantId, async (trx) => {
        const row = await trx
          .selectFrom("threat_events")
          .selectAll()
          .where("id", "=", id)
          .executeTakeFirst();
        return row ? mapRow(row) : undefined;
      });
    },

    async transitionFinality(tenantId, id, to, options) {
      return withTenantTransaction(db, tenantId, async (trx) => {
        const current = await trx
          .selectFrom("threat_events")
          .selectAll()
          .where("id", "=", id)
          .executeTakeFirst();
        if (!current) {
          return { ok: false as const, reason: "not_found" as const };
        }

        const from = current.finality_state as FinalityState;
        const transition = assertFinalityTransition(from, to);
        if (!transition.ok) {
          return {
            ok: false as const,
            reason: "invalid_transition" as const,
            message: transition.message,
          };
        }

        if (from === to) {
          return { ok: true as const, event: mapRow(current) };
        }

        const row = await trx
          .updateTable("threat_events")
          .set({
            finality_state: to,
            finality_reason: options.reason ?? null,
            finalized_at: to === "finalized" ? options.at : null,
            ...(options.findingId !== undefined
              ? { finding_id: options.findingId }
              : {}),
          })
          .where("id", "=", id)
          .returningAll()
          .executeTakeFirstOrThrow();

        return { ok: true as const, event: mapRow(row) };
      });
    },
  };
}
