import { logLifecycle } from "../lib/log";
import type { TelemetryRepository } from "../telemetry/repository";
import {
  assembleAttentionDigest,
  ATTENTION_SOURCE_FETCH_LIMIT,
  resolveAttentionSince,
  type FindingsAttentionDigest,
} from "./attention";
import {
  assembleFindingsDashboard,
  DASHBOARD_RECENT_HOURS,
  type FindingsDashboard,
} from "./dashboard";
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
import type {
  FindingSuppressionInsert,
  FindingSuppressionRow,
  FindingSuppressionsRepository,
} from "./suppression-repository";

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

export type CreateSuppressionOutcome =
  | { ok: true; suppression: FindingSuppressionRow }
  | { ok: false; reason: "conflict" };

export type ClearSuppressionOutcome =
  | { ok: true; suppression: FindingSuppressionRow }
  | { ok: false; reason: "not_found" };

export interface CorrelationService {
  evaluateAfterIngest(tenantId: string, agentId: string): Promise<void>;

  evaluateSilence(
    tenantId: string,
    options?: SilenceEvaluateOptions,
  ): Promise<SilenceEvaluateResult>;

  list(
    tenantId: string,
    query: ListFindingsQuery,
  ): Promise<CorrelationFindingRow[]>;

  /** Operator findings dashboard (fixed 24h windows, zero-filled aggregates). */
  dashboard(tenantId: string): Promise<FindingsDashboard>;

  /**
   * Operator attention digest since an optional cursor.
   * Null/omitted since uses the max lookback window.
   */
  attention(
    tenantId: string,
    requestedSince: Date | null,
  ): Promise<FindingsAttentionDigest>;

  updateStatus(
    tenantId: string,
    findingId: string,
    nextStatus: FindingStatus,
    actor: { userId?: string },
  ): Promise<UpdateStatusOutcome>;

  createSuppression(
    tenantId: string,
    input: FindingSuppressionInsert,
  ): Promise<CreateSuppressionOutcome>;

  clearSuppression(
    tenantId: string,
    id: string,
    actor: { userId?: string },
  ): Promise<ClearSuppressionOutcome>;

  listSuppressions(
    tenantId: string,
  ): Promise<FindingSuppressionRow[]>;
}

export interface CorrelationServiceDeps {
  telemetry: TelemetryRepository;
  findings: CorrelationFindingsRepository;
  suppressions: FindingSuppressionsRepository;
  /** Injectable clock for deterministic tests. Defaults to Date.now. */
  now?: () => Date;
}

const DEFAULT_SILENCE_SCAN_LIMIT = 100;
const MAX_SILENCE_SCAN_LIMIT = 100;

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  const code = (err as { code?: string }).code;
  return code === "23505";
}

export function createCorrelationService(
  deps: CorrelationServiceDeps,
): CorrelationService {
  const { telemetry, findings, suppressions } = deps;
  const now = deps.now ?? (() => new Date());

  async function persistCandidate(
    tenantId: string,
    agentId: string,
    candidate: {
      ruleId: CorrelationRuleId;
      title: string;
      severity: "low" | "medium" | "high";
      evidence: Record<string, unknown>;
      windowStart: Date;
      windowEnd: Date;
      windowBucket: Date;
    },
    at: Date,
  ): Promise<"created" | "deduped" | "snoozed"> {
    const snoozed = await suppressions.isRuleSuppressedAt(
      tenantId,
      candidate.ruleId,
      at,
    );
    if (snoozed) {
      logLifecycle("info", "correlation_finding_snoozed", {
        tenantId,
        agentId,
        ruleId: candidate.ruleId,
      });
      return "snoozed";
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
        ruleId: candidate.ruleId,
        findingId: inserted,
      });
      return "created";
    }
    return "deduped";
  }

  async function tryPersistSilence(
    tenantId: string,
    agentId: string,
    lastHeartbeatAt: Date | null,
    evaluatedAt: Date,
  ): Promise<"created" | "suppressed" | "skipped" | "snoozed"> {
    const candidate = evaluateHeartbeatSilence({
      lastHeartbeatAt,
      now: evaluatedAt,
    });
    if (!candidate) {
      return "skipped";
    }

    const outcome = await persistCandidate(
      tenantId,
      agentId,
      candidate,
      evaluatedAt,
    );
    if (outcome === "deduped") {
      return "suppressed";
    }
    return outcome;
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

        await persistCandidate(tenantId, agentId, candidate, windowEnd);
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
        // snoozed / skipped: no create
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

    async dashboard(tenantId) {
      if (typeof tenantId !== "string" || tenantId.trim() === "") {
        throw new Error("dashboard requires a non-empty tenantId");
      }

      const generatedAt = now();
      const since = new Date(
        generatedAt.getTime() - DASHBOARD_RECENT_HOURS * 60 * 60 * 1000,
      );
      const raw = await findings.getDashboardRawCounts(
        tenantId,
        since,
        generatedAt,
      );
      return assembleFindingsDashboard(generatedAt, raw);
    },

    async attention(tenantId, requestedSince) {
      if (typeof tenantId !== "string" || tenantId.trim() === "") {
        throw new Error("attention requires a non-empty tenantId");
      }

      const generatedAt = now();
      const since = resolveAttentionSince(
        requestedSince ??
          new Date(
            generatedAt.getTime() -
              DASHBOARD_RECENT_HOURS * 60 * 60 * 1000,
          ),
        generatedAt,
      );
      const raw = await findings.getAttentionRawSources(
        tenantId,
        since,
        generatedAt,
        ATTENTION_SOURCE_FETCH_LIMIT,
      );
      return assembleAttentionDigest(generatedAt, since, {
        ...raw,
        sourceTruncated:
          raw.created.length >= ATTENTION_SOURCE_FETCH_LIMIT ||
          raw.statusChanged.length >= ATTENTION_SOURCE_FETCH_LIMIT,
      });
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

    async createSuppression(tenantId, input) {
      if (typeof tenantId !== "string" || tenantId.trim() === "") {
        throw new Error("createSuppression requires a non-empty tenantId");
      }

      try {
        const suppression = await suppressions.insertSuppression(
          tenantId,
          input,
        );
        return { ok: true, suppression };
      } catch (err) {
        if (isUniqueViolation(err)) {
          return { ok: false, reason: "conflict" };
        }
        throw err;
      }
    },

    async clearSuppression(tenantId, id, actor) {
      if (typeof tenantId !== "string" || tenantId.trim() === "") {
        throw new Error("clearSuppression requires a non-empty tenantId");
      }

      const cleared = await suppressions.clearSuppression(
        tenantId,
        id,
        now(),
        actor.userId ?? null,
      );
      if (!cleared) {
        return { ok: false, reason: "not_found" };
      }
      return { ok: true, suppression: cleared };
    },

    async listSuppressions(tenantId) {
      if (typeof tenantId !== "string" || tenantId.trim() === "") {
        throw new Error("listSuppressions requires a non-empty tenantId");
      }
      return suppressions.listUncleared(tenantId);
    },
  };
}
