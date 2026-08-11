import { type NextFunction, type Request, type Response, Router } from "express";

import { requireAgent } from "../auth/authorize";
import { logLifecycle } from "../lib/log";
import { AppError } from "../middleware/error-handler";
import { parseThreatEventEnvelope } from "../threat-events/envelope";
import type { ThreatEventService } from "../threat-events/service";

export interface ThreatEventsRouterOptions {
  threatEvents?: ThreatEventService;
}

/**
 * Agent-signed THREATEVENT ingest.
 *
 * Tenant/agent come from the verified principal only. Body tenantId/agentId
 * must match when present; they are never the source of truth.
 * Ed25519 verify + active device identity happen in ThreatEventService
 * before finality / finding materialization.
 */
export function createThreatEventsRouter(
  options: ThreatEventsRouterOptions = {},
): Router {
  const router = Router();

  router.post("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const principal = requireAgent(req);

      if (!options.threatEvents) {
        throw new AppError(
          "THREAT_EVENT_UNAVAILABLE",
          503,
          "Threat event submission is not available",
        );
      }

      const body = bindEnvelopePrincipal(req.body, principal);
      const parsed = parseThreatEventEnvelope(body);
      if (!parsed.ok) {
        throw new AppError("THREAT_EVENT_INVALID", 400, parsed.message);
      }

      const outcome = await options.threatEvents.submitSigned(
        principal.tenantId,
        principal.agentId,
        parsed.envelope,
      );

      if (!outcome.ok) {
        logLifecycle("warn", "threat_event_submit_rejected", {
          requestId: req.requestId,
          tenantId: principal.tenantId,
          status: outcome.status,
          reason: outcome.reason,
        });

        if (
          outcome.status === "invalid_signature" ||
          outcome.status === "unknown_rule"
        ) {
          throw new AppError("THREAT_EVENT_INVALID", 400, outcome.reason);
        }

        // Non-oracular for missing/revoked/mismatch identity classes.
        throw new AppError(
          "THREAT_EVENT_REJECTED",
          400,
          "Threat event cannot be accepted",
        );
      }

      if (outcome.status === "deduped") {
        res.status(200).json({
          ok: true,
          data: { status: "deduped" },
          requestId: req.requestId,
        });
        return;
      }

      res.status(201).json({
        ok: true,
        data: {
          status: "created",
          threatEventId: outcome.threatEventId,
          findingId: outcome.findingId,
        },
        requestId: req.requestId,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function bindEnvelopePrincipal(
  body: unknown,
  principal: { tenantId: string; agentId: string },
): unknown {
  const copy =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? { ...(body as Record<string, unknown>) }
      : null;

  if (!copy) {
    return body;
  }

  if (
    "tenantId" in copy &&
    typeof copy.tenantId === "string" &&
    copy.tenantId.trim() !== "" &&
    copy.tenantId.trim().toLowerCase() !== principal.tenantId.toLowerCase()
  ) {
    throw new AppError(
      "THREAT_EVENT_REJECTED",
      400,
      "Threat event cannot be accepted",
    );
  }

  if (
    "agentId" in copy &&
    typeof copy.agentId === "string" &&
    copy.agentId.trim() !== "" &&
    copy.agentId.trim().toLowerCase() !== principal.agentId.toLowerCase()
  ) {
    throw new AppError(
      "THREAT_EVENT_REJECTED",
      400,
      "Threat event cannot be accepted",
    );
  }

  copy.tenantId = principal.tenantId;
  copy.agentId = principal.agentId;
  return copy;
}
