import { Router } from "express";

import type { DatabaseHealth, DatabaseHealthCheck } from "../db/pool";

export interface ReadyRouterOptions {
  /**
   * The same probe `/health` reports from. Omitted means no database is wired,
   * which is not ready — see below.
   */
  checkDatabase?: DatabaseHealthCheck;
}

const NOT_CONFIGURED: DatabaseHealth = { status: "not_configured" };

/**
 * Readiness endpoint.
 *
 * Answers one question: can this instance serve database-dependent traffic
 * *now*? It reports the current result of a single probe through the same
 * `createDatabaseHealthCheck` seam `/health` uses — there is deliberately no
 * second probe path, so liveness and readiness can never disagree about the
 * underlying facts, only about how to respond to them.
 *
 *   up              -> 200
 *   down            -> 503
 *   not_configured  -> 503
 *
 * `not_configured` is unready rather than ready-by-default. Every tenant-scoped
 * route fails closed without a database (ADR-0004), so an instance with no
 * database configured cannot serve the traffic readiness gates. Reporting it
 * ready would send requests to an instance guaranteed to fail them.
 *
 * NO DEBOUNCE, HYSTERESIS, OR FAILURE MEMORY, deliberately. A single failed
 * probe reports unready immediately. Tolerance for transient faults is an
 * availability policy and belongs in the deployment's probe configuration —
 * `failureThreshold`, period, timeout — where an operator can see and change
 * it. Building it in here would mean the endpoint reporting "ready" while the
 * database is unreachable, which is simply untrue, and would bury an
 * unreviewable availability decision in application code.
 *
 * This endpoint is unauthenticated, like `/health`, and must stay safe to
 * expose: it returns the probe's bounded status and latency only. Connection
 * errors carry host, port, and user, and are logged by the seam rather than
 * returned.
 */
export function createReadyRouter(options: ReadyRouterOptions = {}): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    // The probe is contracted never to reject. If a future implementation
    // breaks that contract, an unreadable dependency state is not readiness.
    const database = options.checkDatabase
      ? await options.checkDatabase().catch((): DatabaseHealth => ({ status: "down" }))
      : NOT_CONFIGURED;

    const ready = database.status === "up";

    // Probe responses must never be served from a cache: a cached 200 would
    // keep an unready instance in rotation for the cache's lifetime.
    res.setHeader("Cache-Control", "no-store");

    res.status(ready ? 200 : 503).json({
      ready,
      service: "api-gateway",
      timestamp: new Date().toISOString(),
      database,
    });
  });

  return router;
}
