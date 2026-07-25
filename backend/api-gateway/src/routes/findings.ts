import { type NextFunction, type Request, type Response, Router } from "express";

import {
  parseFindingsQueryV1,
  parsePatchFindingStatusBody,
} from "../correlation/query";
import type { CorrelationFindingRow } from "../correlation/repository";
import type { CorrelationService } from "../correlation/service";
import { AppError } from "../middleware/error-handler";
import { requirePrincipal } from "../middleware/tenant-context";

export interface FindingsRouterOptions {
  /**
   * Findings list, silence evaluate, and status triage. When absent, routes
   * fail closed rather than returning unscoped data.
   */
  correlationService?: CorrelationService;
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
    evidence: finding.evidence,
    windowStart: finding.windowStart.toISOString(),
    windowEnd: finding.windowEnd.toISOString(),
    createdAt: finding.createdAt.toISOString(),
  };
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
   * PATCH /v1/findings/:id — operator status triage.
   * Agent principals rejected. Case management / notes deferred.
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

        const parsed = parsePatchFindingStatusBody(req.body);
        if (!parsed.ok) {
          throw new AppError("FINDINGS_INVALID", 400, parsed.message);
        }

        const outcome = await service.updateStatus(
          principal.tenantId,
          findingId.toLowerCase(),
          parsed.status,
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
