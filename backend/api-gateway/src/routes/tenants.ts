import { type NextFunction, type Request, type Response, Router } from "express";

import { logLifecycle } from "../lib/log";
import { AppError } from "../middleware/error-handler";
import { requirePrincipal } from "../middleware/tenant-context";
import type { TenantLookup } from "../tenants/repository";

export interface TenantsRouterOptions {
  /**
   * Resolves the authenticated tenant to its registry record. When absent, the
   * route fails closed rather than falling back to echoing the header.
   */
  lookupTenant?: TenantLookup;
}

export function createTenantsRouter(options: TenantsRouterOptions = {}): Router {
  const router = Router();

  /**
   * Returns the caller's tenant, resolved through a real, RLS-scoped lookup.
   *
   * requireTenant (mounted in app.ts) has already guaranteed a principal. A
   * tenant that does not exist yields the same 400 TENANT_REQUIRED envelope as a
   * missing one, so the endpoint cannot be used to probe which tenants exist;
   * the distinction is recorded in the server log only.
   */
  router.get("/me", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const principal = requirePrincipal(req);

      if (!options.lookupTenant) {
        throw new AppError(
          "TENANT_LOOKUP_UNAVAILABLE",
          503,
          "Tenant lookup is not available",
        );
      }

      const tenant = await options.lookupTenant(principal.tenantId);

      if (!tenant) {
        logLifecycle("warn", "tenant_not_found", {
          requestId: req.requestId,
          tenantId: principal.tenantId,
        });

        throw new AppError("TENANT_REQUIRED", 400, "x-tenant-id header is required");
      }

      res.status(200).json({
        ok: true,
        data: {
          tenantId: tenant.id,
          scope: "tenant",
        },
        requestId: req.requestId,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
