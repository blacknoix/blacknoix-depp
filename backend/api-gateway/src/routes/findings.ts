import { type NextFunction, type Request, type Response, Router } from "express";

import { parseAttentionSinceQuery, parseDismissAttentionBody } from "../correlation/attention";
import {
  parseFindingsQueryV1,
  parsePatchFindingBody,
} from "../correlation/query";
import type { CorrelationFindingRow } from "../correlation/repository";
import type { CorrelationService } from "../correlation/service";
import type { FindingSuppressionRow } from "../correlation/suppression-repository";
import { parseSuppressionWindow } from "../correlation/suppression";
import type { CorrelationRuleId } from "../correlation/rules";
import {
  parseCreateSharedFindingViewBody,
  SHARED_VIEWS_MAX_PER_TENANT,
} from "../findings-views/contract";
import type {
  FindingSharedViewRow,
  FindingSharedViewsRepository,
} from "../findings-views/repository";
import { AppError } from "../middleware/error-handler";
import { requirePrincipal } from "../middleware/tenant-context";

export interface FindingsRouterOptions {
  /**
   * Findings list, silence evaluate, and status triage. When absent, routes
   * fail closed rather than returning unscoped data.
   */
  correlationService?: CorrelationService;

  /**
   * Tenant-scoped shared Findings views (operator-only). Omitted → views
   * routes fail closed.
   */
  sharedViews?: FindingSharedViewsRepository;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function serializeFinding(finding: CorrelationFindingRow) {
  return {
    id: finding.id,
    agentId: finding.agentId,
    ruleId: finding.ruleId,
    title: finding.title,
    severity: finding.severity,
    status: finding.status,
    statusChangedAt: finding.statusChangedAt
      ? finding.statusChangedAt.toISOString()
      : null,
    statusChangedByUserId: finding.statusChangedByUserId,
    ownerUserId: finding.ownerUserId,
    ownerChangedAt: finding.ownerChangedAt
      ? finding.ownerChangedAt.toISOString()
      : null,
    ownerChangedByUserId: finding.ownerChangedByUserId,
    operatorNote: finding.operatorNote,
    operatorNoteUpdatedAt: finding.operatorNoteUpdatedAt
      ? finding.operatorNoteUpdatedAt.toISOString()
      : null,
    operatorNoteUpdatedByUserId: finding.operatorNoteUpdatedByUserId,
    evidence: finding.evidence,
    windowStart: finding.windowStart.toISOString(),
    windowEnd: finding.windowEnd.toISOString(),
    createdAt: finding.createdAt.toISOString(),
  };
}

function serializeSuppression(row: FindingSuppressionRow) {
  return {
    id: row.id,
    ruleId: row.ruleId,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    createdByUserId: row.createdByUserId,
    clearedAt: row.clearedAt ? row.clearedAt.toISOString() : null,
    clearedByUserId: row.clearedByUserId,
  };
}

function serializeSharedView(row: FindingSharedViewRow) {
  return {
    id: row.id,
    name: row.name,
    filters: row.filters,
    createdAt: row.createdAt.toISOString(),
    createdByUserId: row.createdByUserId,
  };
}

function requireOperatorPrincipal(req: Request) {
  const principal = requirePrincipal(req);
  if (principal.agentId) {
    throw new AppError(
      "FINDINGS_REJECTED",
      403,
      "Shared views require an operator principal",
    );
  }
  return principal;
}

/**
 * Tenant-scoped correlation findings list, silence maintenance, and triage.
 *
 * This is not a full alert / case-management console.
 */
export function createFindingsRouter(
  options: FindingsRouterOptions = {},
): Router {
  const router = Router();

  router.get(
    "/",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const principal = requirePrincipal(req);
        const service = requireCorrelationService(options);

        const parsed = parseFindingsQueryV1(req.query, {
          principalAgentId: principal.agentId,
          principalUserId: principal.userId,
        });

        if (!parsed.ok) {
          if (parsed.message === "agent identity mismatch") {
            throw new AppError(
              "FINDINGS_REJECTED",
              400,
              "Findings query cannot be accepted",
            );
          }
          throw new AppError("FINDINGS_INVALID", 400, parsed.message);
        }

        const findings = await service.list(principal.tenantId, parsed.query);

        res.status(200).json({
          ok: true,
          data: {
            findings: findings.map(serializeFinding),
            page: {
              limit: parsed.query.limit,
              offset: parsed.query.offset,
              returned: findings.length,
            },
          },
          requestId: req.requestId,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * GET /v1/findings/dashboard — operator current-state read-model.
   * Fixed 24h windows; no query filters. Agents rejected. UI/charts deferred.
   */
  router.get(
    "/dashboard",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const principal = requirePrincipal(req);
        const service = requireCorrelationService(options);

        if (principal.agentId) {
          throw new AppError(
            "FINDINGS_REJECTED",
            403,
            "Findings dashboard requires an operator principal",
          );
        }

        const queryKeys = Object.keys(req.query);
        if (queryKeys.length > 0) {
          throw new AppError(
            "FINDINGS_INVALID",
            400,
            "dashboard does not accept query parameters",
          );
        }

        const dashboard = await service.dashboard(principal.tenantId);

        res.status(200).json({
          ok: true,
          data: {
            generatedAt: dashboard.generatedAt.toISOString(),
            window: { hours: dashboard.windowHours },
            countsByStatus: dashboard.countsByStatus,
            countsByRuleId: dashboard.countsByRuleId,
            recentCreatedCount: dashboard.recentCreatedCount,
            recentChangedCount: dashboard.recentChangedCount,
            activeSuppressionCount: dashboard.activeSuppressionCount,
          },
          requestId: req.requestId,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * GET /v1/findings/attention — operator pull-based attention digest plus
   * soft ownership reminders, soft due reminders, and Action needed
   * escalation (overdue explicit reminders / long-quiet owned findings).
   * Optional `since` (ISO). Max lookback 24h. Agents rejected.
   * Not a notification inbox, delivery channel, SLA engine, or live stream.
   */
  router.get(
    "/attention",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const principal = requirePrincipal(req);
        const service = requireCorrelationService(options);

        if (principal.agentId) {
          throw new AppError(
            "FINDINGS_REJECTED",
            403,
            "Findings attention requires an operator principal",
          );
        }

        const parsed = parseAttentionSinceQuery(req.query);
        if (!parsed.ok) {
          throw new AppError("FINDINGS_INVALID", 400, parsed.message);
        }

        const digest = await service.attention(
          principal.tenantId,
          parsed.since,
          { userId: principal.userId },
        );

        res.status(200).json({
          ok: true,
          data: {
            generatedAt: digest.generatedAt.toISOString(),
            since: digest.since.toISOString(),
            maxLookbackHours: digest.maxLookbackHours,
            openCount: digest.openCount,
            activeSuppressionCount: digest.activeSuppressionCount,
            truncated: digest.truncated,
            items: digest.items.map((item) => ({
              kind: item.kind,
              findingId: item.findingId,
              title: item.title,
              status: item.status,
              ruleId: item.ruleId,
              agentId: item.agentId,
              at: item.at.toISOString(),
            })),
            reminders: {
              quietHours: digest.reminders.quietHours,
              truncated: digest.reminders.truncated,
              items: digest.reminders.items.map((item) => ({
                kind: item.kind,
                findingId: item.findingId,
                title: item.title,
                status: item.status,
                ruleId: item.ruleId,
                agentId: item.agentId,
                at: item.at.toISOString(),
              })),
            },
            dueReminders: {
              truncated: digest.dueReminders.truncated,
              items: digest.dueReminders.items.map((item) => ({
                kind: item.kind,
                findingId: item.findingId,
                title: item.title,
                status: item.status,
                ruleId: item.ruleId,
                agentId: item.agentId,
                at: item.at.toISOString(),
              })),
            },
            actionNeeded: {
              overdueHours: digest.actionNeeded.overdueHours,
              escalationQuietHours: digest.actionNeeded.escalationQuietHours,
              truncated: digest.actionNeeded.truncated,
              items: digest.actionNeeded.items.map((item) => ({
                kind: item.kind,
                findingId: item.findingId,
                title: item.title,
                status: item.status,
                ruleId: item.ruleId,
                agentId: item.agentId,
                at: item.at.toISOString(),
              })),
            },
          },
          requestId: req.requestId,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * POST /v1/findings/attention/dismiss — dismiss a derived follow-up until
   * its condition watermark advances or the attention kind class changes.
   * Operator identity required. Change-feed items are not dismissable here.
   */
  router.post(
    "/attention/dismiss",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const principal = requirePrincipal(req);
        const service = requireCorrelationService(options);

        if (principal.agentId) {
          throw new AppError(
            "FINDINGS_REJECTED",
            403,
            "Attention dismiss requires an operator principal",
          );
        }
        if (!principal.userId) {
          throw new AppError(
            "FINDINGS_REJECTED",
            403,
            "Operator identity is required to dismiss attention items",
          );
        }

        const parsed = parseDismissAttentionBody(req.body);
        if (!parsed.ok) {
          throw new AppError("FINDINGS_INVALID", 400, parsed.message);
        }

        const outcome = await service.dismissAttentionItem(
          principal.tenantId,
          parsed.dismiss,
          { userId: principal.userId },
        );
        if (!outcome.ok) {
          throw new AppError("FINDINGS_REJECTED", 403, outcome.message);
        }

        res.status(200).json({
          ok: true,
          data: {
            findingId: parsed.dismiss.findingId,
            kind: parsed.dismiss.kind,
            conditionAt: parsed.dismiss.conditionAt.toISOString(),
          },
          requestId: req.requestId,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * POST /v1/findings/evaluate-silence — operator maintenance seam.
   * Agent principals are rejected. Full scheduler/job framework is deferred.
   */
  router.post(
    "/evaluate-silence",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const principal = requirePrincipal(req);
        const service = requireCorrelationService(options);

        if (principal.agentId) {
          throw new AppError(
            "FINDINGS_REJECTED",
            403,
            "Silence evaluation requires an operator principal",
          );
        }

        const parsed = parseEvaluateSilenceBody(req.body);
        if (!parsed.ok) {
          throw new AppError("FINDINGS_INVALID", 400, parsed.message);
        }

        const result = await service.evaluateSilence(
          principal.tenantId,
          parsed.options,
        );

        res.status(200).json({
          ok: true,
          data: result,
          requestId: req.requestId,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * GET /v1/findings/suppressions — list uncleared snoozes (operator read).
   */
  router.get(
    "/suppressions",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const principal = requirePrincipal(req);
        const service = requireCorrelationService(options);

        if (principal.agentId) {
          throw new AppError(
            "FINDINGS_REJECTED",
            403,
            "Suppression management requires an operator principal",
          );
        }

        const rows = await service.listSuppressions(principal.tenantId);
        res.status(200).json({
          ok: true,
          data: {
            suppressions: rows.map(serializeSuppression),
          },
          requestId: req.requestId,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * POST /v1/findings/suppressions — create a time-bounded rule snooze.
   * Skips new finding creation while active; does not mutate existing findings.
   */
  router.post(
    "/suppressions",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const principal = requirePrincipal(req);
        const service = requireCorrelationService(options);

        if (principal.agentId) {
          throw new AppError(
            "FINDINGS_REJECTED",
            403,
            "Suppression management requires an operator principal",
          );
        }

        const parsed = parseCreateSuppressionBody(req.body, new Date());
        if (!parsed.ok) {
          throw new AppError("FINDINGS_INVALID", 400, parsed.message);
        }

        const outcome = await service.createSuppression(principal.tenantId, {
          ruleId: parsed.window.ruleId,
          startsAt: parsed.window.startsAt,
          endsAt: parsed.window.endsAt,
          createdByUserId: principal.userId ?? null,
        });

        if (!outcome.ok) {
          throw new AppError(
            "FINDINGS_CONFLICT",
            409,
            "An uncleared suppression already exists for this rule",
          );
        }

        res.status(201).json({
          ok: true,
          data: { suppression: serializeSuppression(outcome.suppression) },
          requestId: req.requestId,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * DELETE /v1/findings/suppressions/:id — soft-clear a snooze.
   */
  router.delete(
    "/suppressions/:id",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const principal = requirePrincipal(req);
        const service = requireCorrelationService(options);

        if (principal.agentId) {
          throw new AppError(
            "FINDINGS_REJECTED",
            403,
            "Suppression management requires an operator principal",
          );
        }

        const id = typeof req.params.id === "string" ? req.params.id : "";
        if (!UUID.test(id)) {
          throw new AppError(
            "FINDINGS_NOT_FOUND",
            404,
            "Suppression not found",
          );
        }

        const outcome = await service.clearSuppression(
          principal.tenantId,
          id.toLowerCase(),
          { userId: principal.userId },
        );

        if (!outcome.ok) {
          throw new AppError(
            "FINDINGS_NOT_FOUND",
            404,
            "Suppression not found",
          );
        }

        res.status(200).json({
          ok: true,
          data: { suppression: serializeSuppression(outcome.suppression) },
          requestId: req.requestId,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * GET /v1/findings/views — list tenant shared Findings views (operator).
   */
  router.get(
    "/views",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const principal = requireOperatorPrincipal(req);
        const repo = requireSharedViews(options);
        const views = await repo.list(principal.tenantId);
        res.status(200).json({
          ok: true,
          data: { views: views.map(serializeSharedView) },
          requestId: req.requestId,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * POST /v1/findings/views — create a shared Findings view (operator).
   */
  router.post(
    "/views",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const principal = requireOperatorPrincipal(req);
        const repo = requireSharedViews(options);
        const parsed = parseCreateSharedFindingViewBody(req.body);
        if (!parsed.ok) {
          throw new AppError("FINDINGS_INVALID", 400, parsed.message);
        }

        const outcome = await repo.insert(principal.tenantId, {
          name: parsed.input.name,
          filters: parsed.input.filters,
          createdByUserId: principal.userId ?? null,
        });

        if (!outcome.ok) {
          if (outcome.reason === "limit") {
            throw new AppError(
              "FINDINGS_CONFLICT",
              409,
              `At most ${SHARED_VIEWS_MAX_PER_TENANT} shared views are allowed`,
            );
          }
          throw new AppError(
            "FINDINGS_CONFLICT",
            409,
            "A shared view with this name already exists",
          );
        }

        res.status(201).json({
          ok: true,
          data: { view: serializeSharedView(outcome.view) },
          requestId: req.requestId,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * DELETE /v1/findings/views/:id — delete a shared Findings view (operator).
   */
  router.delete(
    "/views/:id",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const principal = requireOperatorPrincipal(req);
        const repo = requireSharedViews(options);
        const id = typeof req.params.id === "string" ? req.params.id : "";
        if (!UUID.test(id)) {
          throw new AppError("FINDINGS_NOT_FOUND", 404, "Shared view not found");
        }

        const deleted = await repo.deleteById(
          principal.tenantId,
          id.toLowerCase(),
        );
        if (!deleted) {
          throw new AppError("FINDINGS_NOT_FOUND", 404, "Shared view not found");
        }

        res.status(200).json({
          ok: true,
          data: { view: serializeSharedView(deleted) },
          requestId: req.requestId,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * PATCH /v1/findings/:id — operator status triage, ownership
   * (claim / clear / reassign to a tenant operator), and current note.
   * Agent principals rejected. Bulk assign, notifications, and case entities
   * are deferred.
   */
  router.patch(
    "/:id",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const principal = requirePrincipal(req);
        const service = requireCorrelationService(options);

        if (principal.agentId) {
          throw new AppError(
            "FINDINGS_REJECTED",
            403,
            "Finding triage requires an operator principal",
          );
        }

        const findingId = typeof req.params.id === "string" ? req.params.id : "";
        if (!UUID.test(findingId)) {
          throw new AppError(
            "FINDINGS_NOT_FOUND",
            404,
            "Finding not found",
          );
        }

        const parsed = parsePatchFindingBody(req.body);
        if (!parsed.ok) {
          throw new AppError("FINDINGS_INVALID", 400, parsed.message);
        }

        const outcome = await service.patchFinding(
          principal.tenantId,
          findingId.toLowerCase(),
          parsed.patch,
          { userId: principal.userId },
        );

        if (!outcome.ok) {
          if (outcome.reason === "not_found") {
            throw new AppError(
              "FINDINGS_NOT_FOUND",
              404,
              "Finding not found",
            );
          }
          if (outcome.reason === "rejected") {
            throw new AppError("FINDINGS_REJECTED", 403, outcome.message);
          }
          throw new AppError("FINDINGS_INVALID", 400, outcome.message);
        }

        res.status(200).json({
          ok: true,
          data: { finding: serializeFinding(outcome.finding) },
          requestId: req.requestId,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}

function requireCorrelationService(
  options: FindingsRouterOptions,
): CorrelationService {
  if (!options.correlationService) {
    throw new AppError(
      "FINDINGS_UNAVAILABLE",
      503,
      "Correlation findings are not available",
    );
  }
  return options.correlationService;
}

function requireSharedViews(
  options: FindingsRouterOptions,
): FindingSharedViewsRepository {
  if (!options.sharedViews) {
    throw new AppError(
      "FINDINGS_UNAVAILABLE",
      503,
      "Shared findings views are not available",
    );
  }
  return options.sharedViews;
}

type ParseEvaluateSilenceResult =
  | { ok: true; options: { agentId?: string } }
  | { ok: false; message: string };

function parseEvaluateSilenceBody(body: unknown): ParseEvaluateSilenceResult {
  // Empty / missing body is valid (tenant-wide capped scan).
  if (body === undefined || body === null) {
    return { ok: true, options: {} };
  }

  if (typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "body must be a JSON object" };
  }

  const record = body as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (key === "tenantId" || key === "tenant_id" || key === "tid") {
      return {
        ok: false,
        message: "tenant identity must not be supplied in the body",
      };
    }
    if (key !== "agentId") {
      return { ok: false, message: `unknown field: ${key}` };
    }
  }

  if (!("agentId" in record)) {
    return { ok: true, options: {} };
  }

  if (typeof record.agentId !== "string" || !UUID.test(record.agentId.trim())) {
    return { ok: false, message: "agentId must be a UUID" };
  }

  return {
    ok: true,
    options: { agentId: record.agentId.trim().toLowerCase() },
  };
}

type ParseCreateSuppressionResult =
  | {
      ok: true;
      window: {
        ruleId: CorrelationRuleId;
        startsAt: Date;
        endsAt: Date;
      };
    }
  | { ok: false; message: string };

function parseCreateSuppressionBody(
  body: unknown,
  now: Date,
): ParseCreateSuppressionResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "body must be a JSON object" };
  }

  const record = body as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (key === "tenantId" || key === "tenant_id" || key === "tid") {
      return {
        ok: false,
        message: "tenant identity must not be supplied in the body",
      };
    }
    if (key !== "ruleId" && key !== "until" && key !== "startsAt") {
      return { ok: false, message: `unknown field: ${key}` };
    }
  }

  return parseSuppressionWindow(
    {
      ruleId: record.ruleId,
      until: record.until,
      startsAt: record.startsAt,
    },
    now,
  );
}
