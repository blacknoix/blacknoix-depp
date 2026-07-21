import { Router } from "express";

import { requirePrincipal } from "../middleware/tenant-context";

const router = Router();

/**
 * Returns the tenant context resolved for the current request.
 *
 * Tenant identity comes from the authenticated principal, never from parsing
 * headers here: how a caller proves their tenant is the auth layer's concern.
 * The requireTenant guard is applied at the mount point in app.ts.
 */
router.get("/me", (req, res) => {
  const { tenantId } = requirePrincipal(req);

  res.status(200).json({
    ok: true,
    data: {
      tenantId,
      scope: "tenant",
    },
    requestId: req.requestId,
  });
});

export default router;
