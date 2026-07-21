import { Router } from "express";

const router = Router();

/**
 * Returns the tenant context resolved for the current request.
 *
 * The requireTenant guard is applied at the mount point in app.ts, so
 * req.tenantId is guaranteed to be present by the time this handler runs.
 */
router.get("/me", (req, res) => {
  res.status(200).json({
    ok: true,
    data: {
      tenantId: req.tenantId,
      scope: "tenant",
    },
    requestId: req.requestId,
  });
});

export default router;
