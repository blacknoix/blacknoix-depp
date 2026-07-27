import { Router } from "express";

const router = Router();

/**
 * Service identity endpoint.
 *
 * Kept in its existing non-enveloped shape for compatibility. This and /health
 * are infrastructure probes, not part of the versioned API surface, which uses
 * the { ok, data, requestId } envelope under /v1.
 */
router.get("/", (_req, res) => {
  res.status(200).json({
    service: "api-gateway",
    status: "ok",
    message: "DEPP API Gateway is running",
  });
});

export default router;
