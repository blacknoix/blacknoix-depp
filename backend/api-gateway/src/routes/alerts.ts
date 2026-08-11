import { type NextFunction, type Request, type Response, Router } from "express";

import { requireAlertReader } from "../auth/authorize";
import { AppError } from "../middleware/error-handler";
import type { AlertsService } from "../alerts/service";

export interface AlertsRouterOptions {
  alertsService?: AlertsService;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tenant-scoped alert read family (telemetry-to-auditable-alert-v1).
 *
 * GET / and GET /:id — human operator or auditor only. Agents denied.
 * No mutation/lifecycle endpoints in this slice.
 */
export function createAlertsRouter(options: AlertsRouterOptions = {}): Router {
  const router = Router();

  router.get("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const principal = requireAlertReader(req);

      if (!options.alertsService) {
        throw new AppError(
          "ALERTS_UNAVAILABLE",
          503,
          "Alerts are not available",
        );
      }

      const agentIdRaw = req.query.agentId;
      let agentId: string | undefined;
      if (agentIdRaw !== undefined) {
        if (typeof agentIdRaw !== "string" || !UUID.test(agentIdRaw)) {
          throw new AppError(
            "ALERTS_INVALID",
            400,
            "agentId must be a UUID when provided",
          );
        }
        agentId = agentIdRaw.toLowerCase();
      }

      // Reject unknown query keys (fail closed; no status filter in this slice).
      for (const key of Object.keys(req.query)) {
        if (key !== "agentId") {
          throw new AppError(
            "ALERTS_INVALID",
            400,
            `unsupported query parameter: ${key}`,
          );
        }
      }

      const alerts = await options.alertsService.list(principal.tenantId, {
        ...(agentId ? { agentId } : {}),
      });

      res.status(200).json({
        ok: true,
        data: { alerts },
        requestId: req.requestId,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get(
    "/:id",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const principal = requireAlertReader(req);

        if (!options.alertsService) {
          throw new AppError(
            "ALERTS_UNAVAILABLE",
            503,
            "Alerts are not available",
          );
        }

        const id = req.params.id;
        if (typeof id !== "string" || !UUID.test(id)) {
          throw new AppError("ALERTS_INVALID", 400, "alert id must be a UUID");
        }

        const alert = await options.alertsService.getById(
          principal.tenantId,
          id.toLowerCase(),
        );

        if (!alert) {
          // Non-oracular: missing and cross-tenant look identical.
          throw new AppError("ALERTS_NOT_FOUND", 404, "Alert not found");
        }

        res.status(200).json({
          ok: true,
          data: { alert },
          requestId: req.requestId,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
