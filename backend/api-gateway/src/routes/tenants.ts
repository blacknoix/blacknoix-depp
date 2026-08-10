import { type NextFunction, type Request, type Response, Router } from "express";

import { requireTenantSelfReader } from "../auth/authorize";
import { logLifecycle } from "../lib/log";
import { AppError } from "../middleware/error-handler";
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
   * Returns the caller's tenant id as a minimal identity echo (tenantId + scope).
   * Does not expose slug, name, billing, membership, or config.
   *
   * Authorization: human operator or auditor (`requireTenantSelfReader`).
   * Agents are denied — agent JWTs already carry tenant id.
   * Tenant comes only from the principal; unknown tenants yield the same
   * 400 TENANT_REQUIRED envelope as a missing principal (non-oracular).
   */
  router.get("/me", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const principal = requireTenantSelfReader(req);

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
