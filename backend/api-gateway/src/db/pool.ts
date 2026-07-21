import { Pool } from "pg";

import { logLifecycle } from "../lib/log";

/**
 * Connection pool and reachability check for api-gateway.
 *
 * Scope note (ADR-0004, slice A): this module owns the connection only. There is
 * no schema, no query layer, and no tenant context here yet. Kysely wraps this
 * pool in slice B — its PostgresDialect takes a `pg` Pool directly, so nothing
 * built here needs to change.
 *
 * When the query layer lands, every tenant-scoped read must go through a
 * transaction that first sets `app.current_tenant` transaction-locally. Nothing
 * in this file should ever acquire a connection for tenant-owned data.
 */

const CONNECTION_TIMEOUT_MS = 5_000;
const IDLE_TIMEOUT_MS = 30_000;
const MAX_CLIENTS = 10;

/** Upper bound on how long a health check may take before reporting down. */
const HEALTH_CHECK_TIMEOUT_MS = 2_000;

export type DatabaseStatus = "not_configured" | "up" | "down";

export interface DatabaseHealth {
  status: DatabaseStatus;
  /** Round-trip time of the probe query. Present only when status is "up". */
  latencyMs?: number;
}

export type DatabaseHealthCheck = () => Promise<DatabaseHealth>;

export function createPool(connectionString: string): Pool {
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    max: MAX_CLIENTS,
    application_name: "depp-api-gateway",
  });

  // Required. An idle client emitting an error with no listener attached is an
  // unhandled 'error' event, which terminates the process.
  pool.on("error", (err) => {
    logLifecycle("error", "db_pool_error", {
      errorName: err.name,
      errorMessage: err.message,
    });
  });

  return pool;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`database probe exceeded ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/**
 * Builds a reachability probe for the health endpoint.
 *
 * Never rejects: an unreachable database is a reported status, not a failed
 * request. Failure detail is written to the server log only — connection errors
 * routinely contain host, port, and user, none of which belongs in an
 * unauthenticated HTTP response.
 */
export function createDatabaseHealthCheck(pool: Pool | undefined): DatabaseHealthCheck {
  if (!pool) {
    return async () => ({ status: "not_configured" });
  }

  return async () => {
    const startedAt = process.hrtime.bigint();

    try {
      await withTimeout(pool.query("select 1"), HEALTH_CHECK_TIMEOUT_MS);

      const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

      return { status: "up", latencyMs: Math.round(latencyMs * 1000) / 1000 };
    } catch (err) {
      const described = err instanceof Error ? err : new Error(String(err));

      logLifecycle("warn", "db_health_check_failed", {
        errorName: described.name,
        errorMessage: described.message,
      });

      return { status: "down" };
    }
  };
}

export async function closePool(pool: Pool | undefined): Promise<void> {
  if (!pool) {
    return;
  }

  try {
    await pool.end();
    logLifecycle("info", "db_pool_closed", {});
  } catch (err) {
    const described = err instanceof Error ? err : new Error(String(err));

    logLifecycle("error", "db_pool_close_failed", {
      errorName: described.name,
      errorMessage: described.message,
    });
  }
}
