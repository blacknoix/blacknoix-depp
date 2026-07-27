import { Router, type NextFunction, type Request, type Response } from "express";

import { AppError } from "../middleware/error-handler";
import { requirePrincipal } from "../middleware/tenant-context";
import {
  parseCreateSharedWorkViewBody,
  WORK_SHARED_VIEWS_MAX_PER_TENANT,
} from "../work-views/contract";
import type {
  WorkSharedViewRow,
  WorkSharedViewsRepository,
} from "../work-views/repository";

export interface WorkRouterOptions {
  sharedWorkViews?: WorkSharedViewsRepository;
}

function serializeSharedWorkView(row: WorkSharedViewRow) {
  return {
    id: row.id,
    name: row.name,
    definition: row.definition,
    createdAt: row.createdAt.toISOString(),
    createdByUserId: row.createdByUserId,
  };
}

function requireOperatorPrincipal(req: Request) {
  const principal = requirePrincipal(req);
  if (principal.agentId) {
    throw new AppError(
      "WORK_REJECTED",
      403,
      "Shared Work views require an operator principal",
    );
  }
  return principal;
}

function requireSharedWorkViews(
  options: WorkRouterOptions,
): WorkSharedViewsRepository {
  if (!options.sharedWorkViews) {
    throw new AppError(
      "WORK_UNAVAILABLE",
      503,
      "Shared Work views are not configured",
    );
  }
  return options.sharedWorkViews;
}

/**
 * Operator Work product routes.
 * Views only — not a dashboard or collaboration platform.
 */
export function createWorkRouter(options: WorkRouterOptions = {}): Router {
  const router = Router();

  /**
   * GET /v1/work/views — list tenant shared Work views (operator).
   */
  router.get(
    "/views",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const principal = requireOperatorPrincipal(req);
        const repo = requireSharedWorkViews(options);
        const views = await repo.list(principal.tenantId);
        res.status(200).json({
          ok: true,
          data: { views: views.map(serializeSharedWorkView) },
          requestId: req.requestId,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * POST /v1/work/views — create a shared Work view (operator).
   */
  router.post(
    "/views",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const principal = requireOperatorPrincipal(req);
        const repo = requireSharedWorkViews(options);
        const parsed = parseCreateSharedWorkViewBody(req.body);
        if (!parsed.ok) {
          throw new AppError("WORK_INVALID", 400, parsed.message);
        }

        const outcome = await repo.insert(principal.tenantId, {
          name: parsed.input.name,
          definition: parsed.input.definition,
          createdByUserId: principal.userId ?? null,
        });

        if (!outcome.ok) {
          if (outcome.reason === "limit") {
            throw new AppError(
              "WORK_CONFLICT",
              409,
              `At most ${WORK_SHARED_VIEWS_MAX_PER_TENANT} shared Work views are allowed`,
            );
          }
          throw new AppError(
            "WORK_CONFLICT",
            409,
            "A shared Work view with this name already exists",
          );
        }

        res.status(201).json({
          ok: true,
          data: { view: serializeSharedWorkView(outcome.view) },
          requestId: req.requestId,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * DELETE /v1/work/views/:id — delete a shared Work view (operator).
   */
  router.delete(
    "/views/:id",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const principal = requireOperatorPrincipal(req);
        const repo = requireSharedWorkViews(options);
        const id = String(req.params.id ?? "").trim().toLowerCase();
        if (
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            id,
          )
        ) {
          throw new AppError("WORK_NOT_FOUND", 404, "Shared Work view not found");
        }

        const deleted = await repo.deleteById(principal.tenantId, id);
        if (!deleted) {
          throw new AppError(
            "WORK_NOT_FOUND",
            404,
            "Shared Work view not found",
          );
        }

        res.status(200).json({
          ok: true,
          data: { view: serializeSharedWorkView(deleted) },
          requestId: req.requestId,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
