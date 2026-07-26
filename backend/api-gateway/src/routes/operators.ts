import { type NextFunction, type Request, type Response, Router } from "express";

import { AppError } from "../middleware/error-handler";
import { requirePrincipal } from "../middleware/tenant-context";
import type { UsersRepository } from "../users/repository";

export interface OperatorsRouterOptions {
  /**
   * Tenant-scoped operator list for assignment pickers. Omitted → route fails
   * closed (503). Not a people-management product.
   */
  users?: UsersRepository;
}

/**
 * Minimal operator directory seam for Finding reassignment.
 *
 * GET /v1/operators — bounded list of tenant users (id + presentation fields).
 * Operator principals only; agent principals rejected.
 */
export function createOperatorsRouter(
  options: OperatorsRouterOptions = {},
): Router {
  const router = Router();

  router.get("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const principal = requirePrincipal(req);

      if (principal.agentId) {
        throw new AppError(
          "OPERATORS_REJECTED",
          403,
          "Operator list requires an operator principal",
        );
      }

      if (!options.users) {
        throw new AppError(
          "OPERATORS_UNAVAILABLE",
          503,
          "Operator list is not available",
        );
      }

      const queryKeys = Object.keys(req.query);
      if (queryKeys.length > 0) {
        throw new AppError(
          "OPERATORS_INVALID",
          400,
          "operator list does not accept query parameters",
        );
      }

      const operators = await options.users.listOperators(principal.tenantId);

      res.status(200).json({
        ok: true,
        data: {
          operators: operators.map((op) => ({
            id: op.id,
            email: op.email,
            displayName: op.displayName,
          })),
        },
        requestId: req.requestId,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
