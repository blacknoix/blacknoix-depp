import { logLifecycle } from "../lib/log";
import type { TelemetryRepository } from "../telemetry/repository";
import {
  ACTION_NEEDED_ITEMS_MAX,
  assembleActionNeeded,
  assembleAttentionDigest,
  assembleOwnershipReminders,
  ATTENTION_SOURCE_FETCH_LIMIT,
  emptyActionNeeded,
  emptyDueReminders,
  emptyOwnershipReminders,
  ESCALATION_QUIET_HOURS,
  partitionDueReminders,
  partitionOwnershipReminders,
  REMINDER_ITEMS_MAX,
  REMINDER_OVERDUE_HOURS,
  reminderQuietBefore,
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
import type { FindingPatchInput } from "./query";
import type {
  CorrelationFindingRow,
  CorrelationFindingsRepository,
  ListFindingsQuery,
  UpdateFindingIntentInput,
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

/**
 * Narrow seam for validating reassignment targets. Implemented by the users
 * repository; omitted → reassignment to others fails closed.
 */
export interface OperatorLookup {
  existsInTenant(tenantId: string, userId: string): Promise<boolean>;
}

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

export type PatchFindingOutcome =
  | { ok: true; finding: CorrelationFindingRow }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "invalid_transition"; message: string }
  | { ok: false; reason: "rejected"; message: string };

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
   * Operator attention digest since an optional cursor, plus derived
   * ownership reminders when actor.userId is present.
   * Null/omitted since uses the max lookback window.
   */
  attention(
    tenantId: string,
    requestedSince: Date | null,
    actor?: { userId?: string },
  ): Promise<FindingsAttentionDigest>;

  updateStatus(
    tenantId: string,
    findingId: string,
    nextStatus: FindingStatus,
    actor: { userId?: string },
  ): Promise<UpdateStatusOutcome>;

  /**
   * Partial operator patch: status and/or ownership (claim / clear / reassign)
   * and/or current note.
   */
  patchFinding(
    tenantId: string,
    findingId: string,
    patch: FindingPatchInput,
    actor: { userId?: string },
  ): Promise<PatchFindingOutcome>;

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
  /**
   * Validates reassignment targets against tenant users. Without this,
   * self-claim and clear still work; assign-to-other fails closed.
   */
  operators?: OperatorLookup;
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
  const { telemetry, findings, suppressions, operators } = deps;
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

  async function patchFinding(
    tenantId: string,
    findingId: string,
    patch: FindingPatchInput,
    actor: { userId?: string },
  ): Promise<PatchFindingOutcome> {
    if (typeof tenantId !== "string" || tenantId.trim() === "") {
      throw new Error("patchFinding requires a non-empty tenantId");
    }
    if (typeof findingId !== "string" || findingId.trim() === "") {
      throw new Error("patchFinding requires a non-empty findingId");
    }

    const current = await findings.getFindingById(tenantId, findingId);
    if (!current) {
      return { ok: false, reason: "not_found" };
    }

    const intent: UpdateFindingIntentInput = {};
    const at = now();
    const remindAtProvided = patch.remindAt !== undefined;
    const requestedRemindAt = patch.remindAt;
    const actorUserId = actor.userId?.trim().toLowerCase();
    const activeReminder = await findings.getActiveRevisitReminder(
      tenantId,
      findingId,
    );

    if (patch.status !== undefined) {
      const transition = assertFindingTransition(current.status, patch.status);
      if (!transition.ok) {
        return {
          ok: false,
          reason: "invalid_transition",
          message: transition.message,
        };
      }
      if (transition.kind === "transition") {
        intent.status = patch.status;
        intent.statusChangedAt = at;
        intent.statusChangedByUserId = actor.userId ?? null;
      }
    }

    if ("ownerUserId" in patch || patch.claimOwner === true) {
      let nextOwner: string | null | undefined;
      if (patch.claimOwner === true) {
        if (!actor.userId) {
          return {
            ok: false,
            reason: "rejected",
            message: "Operator identity is required to claim ownership",
          };
        }
        nextOwner = actor.userId;
      } else if (patch.ownerUserId === null) {
        // Clear remains separate from reassignment; actor identity optional.
        nextOwner = null;
      } else if (typeof patch.ownerUserId === "string") {
        if (!actor.userId) {
          return {
            ok: false,
            reason: "rejected",
            message: "Operator identity is required to assign ownership",
          };
        }
        if (patch.ownerUserId === actor.userId) {
          // Self-assign via ownerUserId remains supported (alongside claimOwner).
          nextOwner = actor.userId;
        } else {
          if (!operators) {
            return {
              ok: false,
              reason: "rejected",
              message: "Ownership reassignment is not available",
            };
          }
          const targetExists = await operators.existsInTenant(
            tenantId,
            patch.ownerUserId,
          );
          if (!targetExists) {
            return {
              ok: false,
              reason: "rejected",
              message: "Target operator not found in this tenant",
            };
          }
          nextOwner = patch.ownerUserId;
        }
      }

      if (nextOwner !== undefined && current.ownerUserId !== nextOwner) {
        intent.ownerUserId = nextOwner;
        intent.ownerChangedAt = at;
        intent.ownerChangedByUserId = actor.userId ?? null;
      }
    }

    if ("operatorNote" in patch) {
      let nextNote = patch.operatorNote ?? null;
      if (typeof nextNote === "string") {
        nextNote = nextNote.trim();
        if (nextNote.length === 0) {
          nextNote = null;
        }
      }
      if (current.operatorNote !== nextNote) {
        intent.operatorNote = nextNote;
        intent.operatorNoteUpdatedAt = at;
        intent.operatorNoteUpdatedByUserId = actor.userId ?? null;
      }
    }

    const didTouch =
      intent.statusChangedAt !== undefined ||
      intent.ownerChangedAt !== undefined ||
      intent.operatorNoteUpdatedAt !== undefined;

    const willResolve = intent.status === "resolved";
    const willChangeOwnership = intent.ownerChangedAt !== undefined;

    // Apply finding update first (if any), then reminder side-effects.
    let updatedFinding = current;
    if (Object.keys(intent).length !== 0) {
      const updated = await findings.updateFindingIntent(
        tenantId,
        findingId,
        intent,
      );
      if (!updated) {
        return { ok: false, reason: "not_found" };
      }
      updatedFinding = updated;
    }

    if (!remindAtProvided && Object.keys(intent).length === 0) {
      return { ok: true, finding: current };
    }

    // Reminder semantics:
    // - Explicit set/clear is operator-owned; identity required.
    // - Resolved and ownership-change always clear.
    // - Touch clears only when the reminder is still in the future.
    if (remindAtProvided) {
      if (!actorUserId) {
        return {
          ok: false,
          reason: "rejected",
          message: "Operator identity is required to set or clear reminders",
        };
      }

      if (requestedRemindAt === null) {
        if (activeReminder && activeReminder.ownerUserId !== actorUserId) {
          return {
            ok: false,
            reason: "rejected",
            message: "Can only clear reminders you own",
          };
        }
        await findings.clearRevisitReminder(
          tenantId,
          findingId,
          actorUserId,
        );
      } else {
        // Reminder set
        if (current.status === "resolved" || willResolve) {
          return {
            ok: false,
            reason: "rejected",
            message: "Cannot set reminder on resolved findings",
          };
        }
        if (!(requestedRemindAt instanceof Date) || Number.isNaN(
          requestedRemindAt.getTime(),
        )) {
          return {
            ok: false,
            reason: "rejected",
            message: "remindAt must be a valid timestamp",
          };
        }

        if (requestedRemindAt.getTime() <= at.getTime()) {
          return {
            ok: false,
            reason: "rejected",
            message: "remindAt must be in the future",
          };
        }

        const nextOwner =
          intent.ownerUserId !== undefined ? intent.ownerUserId : current.ownerUserId;
        if (!nextOwner || nextOwner !== actorUserId) {
          return {
            ok: false,
            reason: "rejected",
            message: "Reminder can only be set by the current finding owner",
          };
        }

        await findings.upsertRevisitReminder(
          tenantId,
          findingId,
          actorUserId,
          requestedRemindAt,
          actorUserId,
        );
      }
    } else if (activeReminder) {
      // Auto-clear side-effects when no explicit reminder mutation happens.
      if (willResolve || willChangeOwnership) {
        await findings.clearRevisitReminder(
          tenantId,
          findingId,
          actorUserId ?? null,
        );
      } else if (
        didTouch &&
        activeReminder.remindAt.getTime() > at.getTime()
      ) {
        await findings.clearRevisitReminder(
          tenantId,
          findingId,
          actorUserId ?? null,
        );
      }
    }

    return { ok: true, finding: updatedFinding };
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

    async attention(tenantId, requestedSince, actor) {
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

      let reminders = emptyOwnershipReminders();
      let dueReminders = emptyDueReminders();
      let actionNeeded = emptyActionNeeded();
      const ownerUserId = actor?.userId?.trim().toLowerCase();
      if (ownerUserId) {
        const quietBefore = reminderQuietBefore(generatedAt);
        const escalationQuietBefore = reminderQuietBefore(
          generatedAt,
          ESCALATION_QUIET_HOURS,
        );
        const overdueBefore = reminderQuietBefore(
          generatedAt,
          REMINDER_OVERDUE_HOURS,
        );
        // Fetch enough for soft + escalated bands (oldest-first sources).
        const followUpFetchLimit =
          REMINDER_ITEMS_MAX + ACTION_NEEDED_ITEMS_MAX;

        const reminderRows = await findings.listOwnershipReminders(
          tenantId,
          ownerUserId,
          quietBefore,
          followUpFetchLimit,
        );
        const dueRows = await findings.listDueExplicitRevisitReminders(
          tenantId,
          ownerUserId,
          generatedAt,
          followUpFetchLimit,
        );

        const { softDue, overdue } = partitionDueReminders(
          dueRows,
          overdueBefore,
        );
        const overdueIds = new Set(overdue.map((item) => item.findingId));
        const { softQuiet, escalatedQuiet } = partitionOwnershipReminders(
          reminderRows,
          escalationQuietBefore,
          overdueIds,
        );
        const actionFindingIds = new Set([
          ...overdueIds,
          ...escalatedQuiet.map((item) => item.findingId),
        ]);
        const softDueExclusive = softDue.filter(
          (item) => !actionFindingIds.has(item.findingId),
        );

        const followUpTruncated =
          reminderRows.length >= followUpFetchLimit ||
          dueRows.length >= followUpFetchLimit;
        actionNeeded = assembleActionNeeded(
          [...overdue, ...escalatedQuiet],
          followUpTruncated,
        );
        reminders = assembleOwnershipReminders(
          softQuiet,
          reminderRows.length >= followUpFetchLimit,
        );
        dueReminders = {
          items: softDueExclusive.slice(0, REMINDER_ITEMS_MAX),
          truncated:
            dueRows.length >= followUpFetchLimit ||
            softDueExclusive.length > REMINDER_ITEMS_MAX,
        };
      }

      return assembleAttentionDigest(
        generatedAt,
        since,
        {
          ...raw,
          sourceTruncated:
            raw.created.length >= ATTENTION_SOURCE_FETCH_LIMIT ||
            raw.statusChanged.length >= ATTENTION_SOURCE_FETCH_LIMIT,
        },
        reminders,
        dueReminders,
        actionNeeded,
      );
    },

    async updateStatus(tenantId, findingId, nextStatus, actor) {
      const outcome = await patchFinding(
        tenantId,
        findingId,
        { status: nextStatus },
        actor,
      );
      if (!outcome.ok && outcome.reason === "rejected") {
        return { ok: false, reason: "not_found" };
      }
      return outcome;
    },

    patchFinding,

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
