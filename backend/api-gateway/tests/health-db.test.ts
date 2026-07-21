import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DatabaseHealth } from "../src/db/pool";
import { startTestServer, type TestServer } from "./helpers/test-server";

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

describe("/health database reporting", () => {
  it("reports not_configured when no database is wired", async () => {
    await withServer({}, async (server) => {
      const res = await fetch(`${server.url}/health`);
      const body = await res.json();

      assert.equal(res.status, 200);
      assert.equal(body.ok, true);
      assert.deepEqual(body.database, { status: "not_configured" });
    });
  });

  it("reports up with latency when the probe succeeds", async () => {
    const probe = async (): Promise<DatabaseHealth> => ({ status: "up", latencyMs: 1.5 });

    await withServer({ checkDatabase: probe }, async (server) => {
      const res = await fetch(`${server.url}/health`);
      const body = await res.json();

      assert.equal(res.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.database.status, "up");
      assert.equal(typeof body.database.latencyMs, "number");
    });
  });

  it("stays 200 with ok:true when the database is down", async () => {
    const probe = async (): Promise<DatabaseHealth> => ({ status: "down" });

    await withServer({ checkDatabase: probe }, async (server) => {
      const res = await fetch(`${server.url}/health`);
      const body = await res.json();

      // /health is a liveness signal. An unreachable database must not make the
      // process look dead, or an orchestrator will restart healthy instances.
      assert.equal(res.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.database.status, "down");
    });
  });

  it("does not leak connection details when the probe throws", async () => {
    const probe = async (): Promise<DatabaseHealth> => {
      throw new Error(
        'connect ECONNREFUSED 10.0.0.5:5432 for user "depp_app" password "hunter2"',
      );
    };

    await withServer({ checkDatabase: probe }, async (server) => {
      const res = await fetch(`${server.url}/health`);
      const raw = await res.text();

      assert.equal(res.status, 200);
      assert.doesNotMatch(raw, /hunter2|ECONNREFUSED|10\.0\.0\.5|depp_app/);
      assert.equal(JSON.parse(raw).database.status, "down");
    });
  });
});
