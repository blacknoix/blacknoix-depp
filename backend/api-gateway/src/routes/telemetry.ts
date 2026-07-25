import { type NextFunction, type Request, type Response, Router } from "express";

import { logLifecycle } from "../lib/log";
import { AppError } from "../middleware/error-handler";
import { requirePrincipal } from "../middleware/tenant-context";
import {
  parseTelemetryBatchV1,
  parseTelemetryEventV1,
} from "../telemetry/contract";
import { parseTelemetryQueryV1 } from "../telemetry/query";
import type { TelemetryService } from "../telemetry/service";

export interface TelemetryRouterOptions {
  /**
   * Ingest/query path. When absent, the routes fail closed rather than
   * accepting events or returning unscoped data.
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
 * Tenant-scoped telemetry ingest + query.
 *
 * Ingest requires an agent principal. Query allows any tenant principal:
 * agents are scoped to themselves; human operators must pass agentId.
 * Tenant identity always comes from the principal.
 */
export function createTelemetryRouter(
  options: TelemetryRouterOptions = {},
): Router {
  const router = Router();
  const batchMaxEvents = options.batchMaxEvents ?? DEFAULT_BATCH_MAX_EVENTS;

  router.post(
    "/events",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const principal = requireAgentPrincipal(req);
        const service = requireTelemetryService(options);

        const body = bindSingleEventBody(req.body, principal.agentId);
        const parsed = parseTelemetryEventV1(body);
        if (!parsed.ok) {
          throw new AppError("TELEMETRY_INVALID", 400, parsed.message);
        }

        const outcome = await service.ingest(principal.tenantId, parsed.event);

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
        const principal = requireAgentPrincipal(req);
        const service = requireTelemetryService(options);

        const parsed = parseTelemetryBatchV1(req.body, {
          agentId: principal.agentId,
          maxEvents: batchMaxEvents,
        });

        if (!parsed.ok) {
          if (parsed.message.includes("agent identity mismatch")) {
            throw new AppError(
              "TELEMETRY_REJECTED",
              400,
              "Telemetry event cannot be accepted",
            );
          }
          throw new AppError("TELEMETRY_INVALID", 400, parsed.message);
        }

        const outcome = await service.ingestBatch(
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

  /**
   * GET /v1/telemetry/events — recent events + tiny operator summary.
   *
   * Correlation, export, and dashboards are deferred. Empty/unknown agent
   * returns an empty page rather than an existence oracle.
   */
  router.get(
    "/events",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const principal = requirePrincipal(req);
        const service = requireTelemetryService(options);

        const parsed = parseTelemetryQueryV1(req.query, {
          principalAgentId: principal.agentId,
        });

        if (!parsed.ok) {
          if (parsed.message === "agent identity mismatch") {
            throw new AppError(
              "TELEMETRY_REJECTED",
              400,
              "Telemetry query cannot be accepted",
            );
          }
          throw new AppError("TELEMETRY_INVALID", 400, parsed.message);
        }

        const outcome = await service.query(principal.tenantId, parsed.query);

        if (!outcome.ok) {
          // Non-oracular empty page for unknown / cross-tenant agent ids.
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
              page: {
                limit: parsed.query.limit,
                offset: parsed.query.offset,
                returned: 0,
              },
            },
            requestId: req.requestId,
          });
          return;
        }

        res.status(200).json({
          ok: true,
          data: {
            events: outcome.result.events.map((event) => ({
              id: event.id,
              agentId: event.agentId,
              schemaVersion: event.schemaVersion,
              eventType: event.eventType,
              occurredAt: event.occurredAt.toISOString(),
              ingestedAt: event.ingestedAt.toISOString(),
              payload: event.payload,
            })),
            summary: {
              agentId: outcome.result.summary.agentId,
              lastSeenAt: outcome.result.summary.lastSeenAt
                ? outcome.result.summary.lastSeenAt.toISOString()
                : null,
              lastHeartbeatAt: outcome.result.summary.lastHeartbeatAt
                ? outcome.result.summary.lastHeartbeatAt.toISOString()
                : null,
              countsByEventType: outcome.result.summary.countsByEventType,
              totalInWindow: outcome.result.summary.totalInWindow,
            },
            page: {
              limit: parsed.query.limit,
              offset: parsed.query.offset,
              returned: outcome.result.events.length,
            },
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

function requireTelemetryService(
  options: TelemetryRouterOptions,
): TelemetryService {
  if (!options.telemetryService) {
    throw new AppError(
      "TELEMETRY_UNAVAILABLE",
      503,
      "Telemetry ingestion is not available",
    );
  }
  return options.telemetryService;
}

function requireAgentPrincipal(req: Request) {
  const principal = requirePrincipal(req);

  if (!principal.agentId) {
    throw new AppError(
      "AGENT_AUTH_REQUIRED",
      401,
      "Agent authentication is required",
    );
  }

  return principal as typeof principal & { agentId: string };
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
