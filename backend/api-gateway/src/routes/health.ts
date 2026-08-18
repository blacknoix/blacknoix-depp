import { Router } from "express";

import type { DatabaseHealth, DatabaseHealthCheck } from "../db/pool";

export interface HealthRouterOptions {
  /**
   * Optional database reachability probe. When absent, the database is reported
   * as not configured.
   */
  checkDatabase?: DatabaseHealthCheck;
}

const NOT_CONFIGURED: DatabaseHealth = { status: "not_configured" };

/**
 * Liveness endpoint.
 *
 * Always returns 200 with `ok: true` while the process is serving, including
 * when the database is unreachable. `ok` answers "is this process alive", and
 * turning it into a readiness signal would let a database blip cause an
 * orchestrator to restart otherwise-healthy instances.
 *
 * Database state is reported here as information only. Deciding whether the
 * instance can serve database-dependent traffic is `/ready`'s job
 * (`routes/ready.ts`), which reads this same probe and answers 503 when the
 * database is not usable. Keep the two contracts distinct: making this endpoint
 * fail on a database fault is what causes restart loops.
 */
export function createHealthRouter(options: HealthRouterOptions = {}): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    // The probe is contracted never to reject; this guards the endpoint against
    // a future implementation that breaks that contract.
    const database = options.checkDatabase
      ? await options.checkDatabase().catch((): DatabaseHealth => ({ status: "down" }))
      : NOT_CONFIGURED;

    res.status(200).json({
      ok: true,
      service: "api-gateway",
      timestamp: new Date().toISOString(),
      database,
    });
  });

  return router;
}
