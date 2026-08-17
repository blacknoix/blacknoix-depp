import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DatabaseHealth } from "../src/db/pool";
import { startTestServer, type TestServer } from "./helpers/test-server";

/**
 * Readiness contract (ADR-0013 prerequisite).
 *
 * `/ready` reports whether this instance can serve database-dependent traffic
 * now. `/health` stays liveness-only. Both read the same probe; the tests below
 * pin the split, because the failure that matters is the two endpoints quietly
 * converging — either readiness going soft on a fault, or liveness starting to
 * fail on one and causing restart loops.
 *
 * SEAM-LEVEL LIMITATION, stated precisely: these tests inject a
 * `DatabaseHealthCheck` stub. They prove the route's mapping from probe result
 * to HTTP status, and nothing about `createDatabaseHealthCheck`'s own behaviour
 * against a real Postgres — its `select 1`, its timeout, or its error
 * classification. That path is exercised by the database-backed suite
 * (`npm run test:db`), which requires a live database and is not part of
 * `test:unit`.
 */

async function withServer(
  options: Parameters<typeof startTestServer>[0],
  run: (server: TestServer) => Promise<void>,
): Promise<void> {
  const server = await startTestServer(options);

  try {
    await run(server);
  } finally {
    await server.close();
  }
}

describe("GET /ready", () => {
  it("returns 200 when the database probe reports up", async () => {
    const probe = async (): Promise<DatabaseHealth> => ({ status: "up", latencyMs: 1.5 });

    await withServer({ checkDatabase: probe }, async (server) => {
      const res = await fetch(`${server.url}/ready`);
      const body = await res.json();

      assert.equal(res.status, 200);
      assert.equal(body.ready, true);
      assert.equal(body.database.status, "up");
      assert.equal(typeof body.database.latencyMs, "number");
    });
  });

  it("returns 503 when the database probe reports down", async () => {
    const probe = async (): Promise<DatabaseHealth> => ({ status: "down" });

    await withServer({ checkDatabase: probe }, async (server) => {
      const res = await fetch(`${server.url}/ready`);
      const body = await res.json();

      assert.equal(res.status, 503);
      assert.equal(body.ready, false);
      assert.equal(body.database.status, "down");
    });
  });

  it("returns 503 when no database is configured", async () => {
    // Not ready rather than ready-by-default: every tenant-scoped route fails
    // closed without a database, so an instance with none cannot serve the
    // traffic readiness gates.
    await withServer({}, async (server) => {
      const res = await fetch(`${server.url}/ready`);
      const body = await res.json();

      assert.equal(res.status, 503);
      assert.equal(body.ready, false);
      assert.equal(body.database.status, "not_configured");
    });
  });

  it("returns 503 without leaking connection details when the probe throws", async () => {
    const probe = async (): Promise<DatabaseHealth> => {
      throw new Error(
        'connect ECONNREFUSED 10.0.0.5:5432 for user "depp_app" password "hunter2"',
      );
    };

    await withServer({ checkDatabase: probe }, async (server) => {
      const res = await fetch(`${server.url}/ready`);
      const raw = await res.text();

      assert.equal(res.status, 503);
      assert.doesNotMatch(raw, /hunter2|ECONNREFUSED|10\.0\.0\.5|depp_app/);
      assert.equal(JSON.parse(raw).database.status, "down");
    });
  });

  it("is not cacheable", async () => {
    const probe = async (): Promise<DatabaseHealth> => ({ status: "up", latencyMs: 1 });

    await withServer({ checkDatabase: probe }, async (server) => {
      const res = await fetch(`${server.url}/ready`);

      // A cached 200 would keep an unready instance in rotation for the
      // cache's lifetime.
      assert.equal(res.headers.get("cache-control"), "no-store");
    });
  });

  it("reports the current probe result on every request, with no failure memory", async () => {
    // Proves the absence of debounce/hysteresis: readiness must follow the
    // probe immediately in both directions. Tolerance for transient faults is
    // deployment probe configuration, not application state.
    const results: DatabaseHealth[] = [
      { status: "up", latencyMs: 1 },
      { status: "down" },
      { status: "up", latencyMs: 1 },
    ];
    let call = 0;
    const probe = async (): Promise<DatabaseHealth> => results[call++] ?? { status: "down" };

    await withServer({ checkDatabase: probe }, async (server) => {
      const first = await fetch(`${server.url}/ready`);
      assert.equal(first.status, 200, "first probe up");

      const second = await fetch(`${server.url}/ready`);
      assert.equal(second.status, 503, "single failure reports unready immediately");

      const third = await fetch(`${server.url}/ready`);
      assert.equal(third.status, 200, "recovery is immediate, not held down");
    });
  });
});

describe("/health remains liveness-only alongside /ready", () => {
  it("stays 200 when the same probe makes /ready 503", async () => {
    const probe = async (): Promise<DatabaseHealth> => ({ status: "down" });

    await withServer({ checkDatabase: probe }, async (server) => {
      const health = await fetch(`${server.url}/health`);
      const healthBody = await health.json();
      const ready = await fetch(`${server.url}/ready`);

      assert.equal(health.status, 200, "liveness must not fail on a database fault");
      assert.equal(healthBody.ok, true);
      assert.equal(healthBody.database.status, "down");

      assert.equal(ready.status, 503, "readiness must fail on a database fault");
    });
  });

  it("stays 200 with no database configured", async () => {
    await withServer({}, async (server) => {
      const health = await fetch(`${server.url}/health`);
      const healthBody = await health.json();

      assert.equal(health.status, 200);
      assert.equal(healthBody.ok, true);
      assert.deepEqual(healthBody.database, { status: "not_configured" });
    });
  });

  it("keeps its response shape unchanged: ok, service, timestamp, database", async () => {
    const probe = async (): Promise<DatabaseHealth> => ({ status: "up", latencyMs: 2 });

    await withServer({ checkDatabase: probe }, async (server) => {
      const res = await fetch(`${server.url}/health`);
      const body = await res.json();

      assert.deepEqual(Object.keys(body).sort(), ["database", "ok", "service", "timestamp"]);
      assert.equal(body.service, "api-gateway");
      assert.equal(typeof body.timestamp, "string");
    });
  });
});
