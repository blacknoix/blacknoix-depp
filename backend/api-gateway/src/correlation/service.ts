import { logLifecycle } from "../lib/log";
import type { TelemetryRepository } from "../telemetry/repository";
import {
  assertFindingTransition,
  type FindingStatus,
} from "./lifecycle";
import type {
  CorrelationFindingRow,
  CorrelationFindingsRepository,
  ListFindingsQuery,
} from "./repository";
import {
  CORRELATION_RULES,
  evaluateCountRule,
  evaluateHeartbeatSilence,
  SILENCE_THRESHOLD_MS,
  type CorrelationRuleId,
} from "./rules";

export interface SilenceEvaluateOptions {
  /** When set, evaluate only this agent. */
  agentId?: string;
  /** Cap on tenant-wide stale scan. Default 100; clamped 1..100. */
  limit?: number;
}

export interface SilenceEvaluateResult {
  evaluated: number;
  created: number;
  suppressed: number;
}

export type UpdateStatusOutcome =
  | { ok: true; finding: CorrelationFindingRow }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "invalid_transition"; message: string };

export interface CorrelationService {
  /**
   * Runs the fixed v1 count rule set for one agent after successful telemetry
   * ingest. Silence is intentionally not included here.
   */
  evaluateAfterIngest(tenantId: string, agentId: string): Promise<void>;

  /**
   * Operator maintenance path: evaluate heartbeat silence for one agent or a
   * capped tenant scan of stale heartbeat candidates.
   */
  evaluateSilence(
    tenantId: string,
    options?: SilenceEvaluateOptions,
  ): Promise<SilenceEvaluateResult>;

  list(
    tenantId: string,
    query: ListFindingsQuery,
  ): Promise<CorrelationFindingRow[]>;

  /**
   * Operator triage: apply an allowed status transition (or idempotent noop).
   */
  updateStatus(
    tenantId: string,
    findingId: string,
    nextStatus: FindingStatus,
    actor: { userId?: string },
  ): Promise<UpdateStatusOutcome>;
}

export interface CorrelationServiceDeps {
  telemetry: TelemetryRepository;
  findings: CorrelationFindingsRepository;
  /** Injectable clock for deterministic tests. Defaults to Date.now. */
  now?: () => Date;
}

const DEFAULT_SILENCE_SCAN_LIMIT = 100;
const MAX_SILENCE_SCAN_LIMIT = 100;

export function createCorrelationService(
  deps: CorrelationServiceDeps,
): CorrelationService {
  const { telemetry, findings } = deps;
  const now = deps.now ?? (() => new Date());

  async function tryPersistSilence(
    tenantId: string,
    agentId: string,
    lastHeartbeatAt: Date | null,
    evaluatedAt: Date,
  ): Promise<"created" | "suppressed" | "skipped"> {
    const candidate = evaluateHeartbeatSilence({
      lastHeartbeatAt,
      now: evaluatedAt,
    });
    if (!candidate) {
      return "skipped";
    }

    const inserted = await findings.insertFindingIgnoreDup(tenantId, {
      agentId,
      ruleId: candidate.ruleId,
      title: candidate.title,
      severity: candidate.severity,
      evidence: candidate.evidence,
      windowStart: candidate.windowStart,
      windowEnd: candidate.windowEnd,
      windowBucket: candidate.windowBucket,
    });

    if (inserted) {
      logLifecycle("info", "correlation_finding_created", {
        tenantId,
        agentId,
        ruleId: candidate.ruleId as CorrelationRuleId,
        findingId: inserted,
      });
      return "created";
    }
    return "suppressed";
  }

  return {
    async evaluateAfterIngest(tenantId, agentId) {
      if (typeof tenantId !== "string" || tenantId.trim() === "") {
        throw new Error("evaluateAfterIngest requires a non-empty tenantId");
      }
      if (typeof agentId !== "string" || agentId.trim() === "") {
        throw new Error("evaluateAfterIngest requires a non-empty agentId");
      }

      const windowEnd = now();

      for (const rule of CORRELATION_RULES) {
        const windowStart = new Date(windowEnd.getTime() - rule.windowMs);
        const summary = await telemetry.summarizeAgentWindow(
          tenantId,
          agentId,
          {
            since: windowStart,
            until: windowEnd,
            eventTypes: rule.eventTypes,
            sampleLimit: 10,
          },
        );

        const candidate = evaluateCountRule(rule, summary, windowEnd);
        if (!candidate) {
          continue;
        }

        const inserted = await findings.insertFindingIgnoreDup(tenantId, {
          agentId,
          ruleId: candidate.ruleId,
          title: candidate.title,
          severity: candidate.severity,
          evidence: candidate.evidence,
          windowStart: candidate.windowStart,
          windowEnd: candidate.windowEnd,
          windowBucket: candidate.windowBucket,
        });

        if (inserted) {
          logLifecycle("info", "correlation_finding_created", {
            tenantId,
            agentId,
            ruleId: candidate.ruleId as CorrelationRuleId,
            findingId: inserted,
          });
        }
      }
    },

    async evaluateSilence(tenantId, options = {}) {
      if (typeof tenantId !== "string" || tenantId.trim() === "") {
        throw new Error("evaluateSilence requires a non-empty tenantId");
      }

      const evaluatedAt = now();
      const olderThan = new Date(
        evaluatedAt.getTime() - SILENCE_THRESHOLD_MS,
      );
      const limit = Math.min(
        Math.max(1, options.limit ?? DEFAULT_SILENCE_SCAN_LIMIT),
        MAX_SILENCE_SCAN_LIMIT,
      );

      let created = 0;
      let suppressed = 0;
      let evaluated = 0;

      if (options.agentId) {
        const lastHeartbeatAt = await telemetry.getLastHeartbeatAt(
          tenantId,
          options.agentId,
        );
        evaluated = 1;
        const outcome = await tryPersistSilence(
          tenantId,
          options.agentId,
          lastHeartbeatAt,
          evaluatedAt,
        );
        if (outcome === "created") {
          created = 1;
        } else if (outcome === "suppressed") {
          suppressed = 1;
        }
        return { evaluated, created, suppressed };
      }

      const stale = await telemetry.listAgentsWithStaleHeartbeat(tenantId, {
        olderThan,
        limit,
      });

      for (const row of stale) {
        evaluated += 1;
        const outcome = await tryPersistSilence(
          tenantId,
          row.agentId,
          row.lastHeartbeatAt,
          evaluatedAt,
        );
        if (outcome === "created") {
          created += 1;
        } else if (outcome === "suppressed") {
          suppressed += 1;
        }
      }

      return { evaluated, created, suppressed };
    },

    async list(tenantId, query) {
      if (typeof tenantId !== "string" || tenantId.trim() === "") {
        throw new Error("list requires a non-empty tenantId");
      }
      return findings.listFindings(tenantId, query);
    },

    async updateStatus(tenantId, findingId, nextStatus, actor) {
      if (typeof tenantId !== "string" || tenantId.trim() === "") {
        throw new Error("updateStatus requires a non-empty tenantId");
      }
      if (typeof findingId !== "string" || findingId.trim() === "") {
        throw new Error("updateStatus requires a non-empty findingId");
      }

      const current = await findings.getFindingById(tenantId, findingId);
      if (!current) {
        return { ok: false, reason: "not_found" };
      }

      const transition = assertFindingTransition(current.status, nextStatus);
      if (!transition.ok) {
        return {
          ok: false,
          reason: "invalid_transition",
          message: transition.message,
        };
      }

      if (transition.kind === "noop") {
        return { ok: true, finding: current };
      }

      const updated = await findings.updateFindingStatus(tenantId, findingId, {
        status: nextStatus,
        changedAt: now(),
        changedByUserId: actor.userId ?? null,
      });

      if (!updated) {
        return { ok: false, reason: "not_found" };
      }

      return { ok: true, finding: updated };
    },
  };
}
