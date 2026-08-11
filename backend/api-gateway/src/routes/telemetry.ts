import { type NextFunction, type Request, type Response, Router } from "express";

import { requireAgent, requireTelemetryQuerier } from "../auth/authorize";
import { logLifecycle } from "../lib/log";
import { AppError } from "../middleware/error-handler";
import {
  parseTelemetryBatchV1,
  parseTelemetryEventV1,
} from "../telemetry/contract";
import { parseTelemetryQueryV1 } from "../telemetry/query";
import type { TelemetryService } from "../telemetry/service";

export interface TelemetryRouterOptions {
  /**
   * Ingest/query path. When absent, the route fails closed rather than
   * accepting events or serving queries that cannot be persisted/read.
   */
  telemetryService?: TelemetryService;

  /**
   * Max events accepted by POST /events/batch. Defaults to 50 when omitted.
   * Validated at startup when loaded from env.
   */
  batchMaxEvents?: number;
}

const DEFAULT_BATCH_MAX_EVENTS = 50;

/**
 * Tenant-scoped telemetry ingestion and read under /v1/telemetry.
 *
 * Tenant and agent identity come from the verified principal (agent access JWT
 * or, in development, x-tenant-id + x-agent-id). Body agentId / tenantId are
 * never the source of truth for tenancy.
 *
 * Batch ingest (POST /events/batch) is all-or-nothing: any invalid event
 * rejects the whole request with no writes.
 *
 * Ingest (POST /events and /events/batch): requireAgent — agent-only;
 * mode-independent; humans get 401 AGENT_AUTH_REQUIRED.
 *
 * GET /events: human operators (explicit operator / compat empty-role) or
 * self-scoped agents via requireTelemetryQuerier. Auditors and enforce
 * empty-role humans are denied.
 */
export function createTelemetryRouter(
  options: TelemetryRouterOptions = {},
): Router {
  const router = Router();
  const batchMaxEvents = options.batchMaxEvents ?? DEFAULT_BATCH_MAX_EVENTS;

  router.get(
    "/events",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const principal = requireTelemetryQuerier(req);

        if (!options.telemetryService) {
          throw new AppError(
            "TELEMETRY_UNAVAILABLE",
            503,
            "Telemetry query is not available",
          );
        }

        const parsed = parseTelemetryQueryV1(req.query, {
          principalAgentId: principal.agentId,
        });
        if (!parsed.ok) {
          throw new AppError("TELEMETRY_INVALID", 400, parsed.message);
        }

        const outcome = await options.telemetryService.query(
          principal.tenantId,
          parsed.query,
        );

        if (!outcome.ok) {
          // Non-oracular: unknown / cross-tenant agent looks like empty result.
          res.status(200).json({
            ok: true,
            data: {
              events: [],
              summary: {
                agentId: parsed.query.agentId,
                lastSeenAt: null,
                lastHeartbeatAt: null,
                countsByEventType: {},
                totalInWindow: 0,
              },
            },
            requestId: req.requestId,
          });
          return;
        }

        const { events, summary } = outcome.result;
        res.status(200).json({
          ok: true,
          data: {
            events: events.map((event) => ({
              id: event.id,
              eventType: event.eventType,
              occurredAt: event.occurredAt.toISOString(),
              ingestedAt: event.ingestedAt.toISOString(),
              schemaVersion: event.schemaVersion,
              payload: event.payload,
            })),
            summary: {
              agentId: summary.agentId,
              lastSeenAt: summary.lastSeenAt
                ? summary.lastSeenAt.toISOString()
                : null,
              lastHeartbeatAt: summary.lastHeartbeatAt
                ? summary.lastHeartbeatAt.toISOString()
                : null,
              countsByEventType: summary.countsByEventType,
              totalInWindow: summary.totalInWindow,
            },
          },
          requestId: req.requestId,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    "/events",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const principal = requireAgent(req);

        if (!options.telemetryService) {
          throw new AppError(
            "TELEMETRY_UNAVAILABLE",
            503,
            "Telemetry ingestion is not available",
          );
        }

        const body = bindSingleEventBody(req.body, principal.agentId);
        const parsed = parseTelemetryEventV1(body);
        if (!parsed.ok) {
          throw new AppError("TELEMETRY_INVALID", 400, parsed.message);
        }

        const outcome = await options.telemetryService.ingest(
          principal.tenantId,
          parsed.event,
        );

        if (!outcome.ok) {
          logLifecycle("warn", "telemetry_ingest_rejected", {
            requestId: req.requestId,
            tenantId: principal.tenantId,
            reason: outcome.reason,
          });

          throw new AppError(
            "TELEMETRY_REJECTED",
            400,
            "Telemetry event cannot be accepted",
          );
        }

        res.status(201).json({
          ok: true,
          data: {
            id: outcome.event.id,
            ingestedAt: outcome.event.ingestedAt.toISOString(),
          },
          requestId: req.requestId,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    "/events/batch",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const principal = requireAgent(req);

        if (!options.telemetryService) {
          throw new AppError(
            "TELEMETRY_UNAVAILABLE",
            503,
            "Telemetry ingestion is not available",
          );
        }

        const parsed = parseTelemetryBatchV1(req.body, {
          agentId: principal.agentId,
          maxEvents: batchMaxEvents,
        });

        if (!parsed.ok) {
          // Agent identity mismatch is fail-closed and non-oracular at the
          // client: same code family as other reject paths when message is the
          // mismatch form; validation failures stay TELEMETRY_INVALID.
          if (parsed.message.includes("agent identity mismatch")) {
            throw new AppError(
              "TELEMETRY_REJECTED",
              400,
              "Telemetry event cannot be accepted",
            );
          }
          throw new AppError("TELEMETRY_INVALID", 400, parsed.message);
        }

        const outcome = await options.telemetryService.ingestBatch(
          principal.tenantId,
          parsed.events,
        );

        if (!outcome.ok) {
          logLifecycle("warn", "telemetry_batch_rejected", {
            requestId: req.requestId,
            tenantId: principal.tenantId,
            reason: outcome.reason,
            count: parsed.events.length,
          });

          throw new AppError(
            "TELEMETRY_REJECTED",
            400,
            "Telemetry event cannot be accepted",
          );
        }

        res.status(201).json({
          ok: true,
          data: {
            accepted: outcome.events.length,
            events: outcome.events.map((event) => ({
              id: event.id,
              ingestedAt: event.ingestedAt.toISOString(),
            })),
          },
          requestId: req.requestId,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}

function bindSingleEventBody(body: unknown, agentId: string): unknown {
  const copy =
    typeof body === "object" && body !== null
      ? { ...(body as Record<string, unknown>) }
      : body;

  if (
    typeof copy === "object" &&
    copy !== null &&
    "agentId" in copy &&
    copy.agentId !== agentId
  ) {
    throw new AppError(
      "TELEMETRY_REJECTED",
      400,
      "Telemetry event cannot be accepted",
    );
  }

  if (typeof copy === "object" && copy !== null) {
    (copy as Record<string, unknown>).agentId = agentId;
  }

  return copy;
}
