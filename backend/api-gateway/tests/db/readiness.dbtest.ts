import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  closePool,
  createDatabaseHealthCheck,
  createPool,
} from "../../src/db/pool";
import { connectDb, type DbHandles } from "./helpers";
import { startTestServer } from "../helpers/test-server";

/**
 * Live-Postgres readiness evidence for createDatabaseHealthCheck + /ready.
 *
 * Fixture assumptions (same as the rest of `npm run test:db`):
 * - Disposable local Postgres from `infra/docker-compose.yml` is reachable.
 * - Migrations have been applied (`npm run migrate:latest`).
 * - `DATABASE_URL` is the runtime app role (`depp_app`), loaded via tests/test.env.
 * - `DATABASE_MIGRATION_URL` is the migrator role (used only to prove the
 *   fixture is up through connectDb; never used as the healthy probe pool).
 *
 * This file exercises the real `select 1` probe inside createDatabaseHealthCheck
 * against that Postgres. It does not claim staging readiness, platform traffic
 * gating, or a Complete control-matrix row.
 */

/** Unreachable endpoint with deliberate markers we can scan for without printing DATABASE_URL. */
const UNREACHABLE_APP_URL =
  "postgres://ready_probe_user:ready_probe_secret_do_not_leak@127.0.0.1:1/depp";

const LEAK_MARKERS = [
  "ready_probe_user",
  "ready_probe_secret_do_not_leak",
  "postgres://",
  "ECONNREFUSED",
  "password authentication failed",
  "Connection terminated",
] as const;

let fixture: DbHandles;

before(async () => {
  // Fail loudly if the disposable fixture is missing — never skip.
  fixture = await connectDb();
});

after(async () => {
  if (fixture) {
    await fixture.close();
  }
});

function assertNoSensitiveLeak(haystack: string, context: string): void {
  for (const marker of LEAK_MARKERS) {
    if (haystack.includes(marker)) {
      // Deliberately do not interpolate the marker or any connection string.
      assert.fail(`${context}: leaked a sensitive database/driver fragment`);
    }
  }

  const appUrl = process.env.DATABASE_URL;
  if (appUrl && appUrl.length > 0 && haystack.includes(appUrl)) {
    assert.fail(`${context}: leaked DATABASE_URL`);
  }
}

/**
 * Captures stdout while LOG_SILENT is temporarily cleared so lifecycle / route
 * lines from the failing probe can be inspected. Restores prior silence after.
 */
async function withCapturedStdout<T>(run: () => Promise<T>): Promise<{ result: T; captured: string }> {
  const previousSilent = process.env.LOG_SILENT;
  delete process.env.LOG_SILENT;

  const chunks: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return (originalWrite as (chunk: string | Uint8Array, ...args: unknown[]) => boolean)(
      chunk,
      ...(args as []),
    );
  }) as typeof process.stdout.write;

  try {
    const result = await run();
    return { result, captured: chunks.join("") };
  } finally {
    process.stdout.write = originalWrite;
    if (previousSilent === undefined) {
      delete process.env.LOG_SILENT;
    } else {
      process.env.LOG_SILENT = previousSilent;
    }
  }
}

describe("live Postgres readiness (createDatabaseHealthCheck select 1)", () => {
  it("GET /ready returns 200 when createDatabaseHealthCheck succeeds via real app-role SELECT 1", async () => {
    const appUrl = process.env.DATABASE_URL;
    assert.ok(appUrl && appUrl.trim() !== "", "DATABASE_URL (app role) must be set for test:db");

    // Dedicated pool so this test path matches production wiring: createPool →
    // createDatabaseHealthCheck → /ready, not a stubbed DatabaseHealthCheck.
    const pool = createPool(appUrl);
    const checkDatabase = createDatabaseHealthCheck(pool);
    const server = await startTestServer({ checkDatabase });

    try {
      // Direct seam proof: the probe runs select 1 against disposable Postgres.
      const seam = await checkDatabase();
      assert.equal(seam.status, "up", "createDatabaseHealthCheck must report up after real SELECT 1");
      assert.equal(typeof seam.latencyMs, "number");

      const readyRes = await fetch(`${server.url}/ready`);
      const readyRaw = await readyRes.text();
      const readyBody = JSON.parse(readyRaw) as {
        ready: boolean;
        database: { status: string; latencyMs?: number };
      };

      assert.equal(readyRes.status, 200);
      assert.equal(readyRes.headers.get("cache-control"), "no-store");
      assert.equal(readyBody.ready, true);
      assert.equal(readyBody.database.status, "up");
      assert.equal(typeof readyBody.database.latencyMs, "number");
      assertNoSensitiveLeak(readyRaw, "healthy /ready body");

      const healthRes = await fetch(`${server.url}/health`);
      const healthBody = (await healthRes.json()) as {
        ok: boolean;
        database: { status: string };
      };

      assert.equal(healthRes.status, 200, "/health stays liveness-only when DB is up");
      assert.equal(healthBody.ok, true);
      assert.equal(healthBody.database.status, "up");
    } finally {
      await server.close();
      await closePool(pool);
    }
  });

  it("GET /ready returns 503 on unreachable DATABASE_URL while /health stays 200; response and logs stay non-leaking", async () => {
    const pool = createPool(UNREACHABLE_APP_URL);
    const checkDatabase = createDatabaseHealthCheck(pool);
    const server = await startTestServer({ checkDatabase });

    try {
      const { result, captured } = await withCapturedStdout(async () => {
        const readyRes = await fetch(`${server.url}/ready`);
        const readyRaw = await readyRes.text();
        const healthRes = await fetch(`${server.url}/health`);
        const healthRaw = await healthRes.text();
        return { readyRes, readyRaw, healthRes, healthRaw };
      });

      assert.equal(result.readyRes.status, 503);
      assert.equal(result.readyRes.headers.get("cache-control"), "no-store");

      const readyBody = JSON.parse(result.readyRaw) as {
        ready: boolean;
        database: { status: string; latencyMs?: number };
      };
      assert.equal(readyBody.ready, false);
      assert.equal(readyBody.database.status, "down");
      assert.equal(readyBody.database.latencyMs, undefined);
      assertNoSensitiveLeak(result.readyRaw, "unready /ready body");

      assert.equal(result.healthRes.status, 200, "/health must remain 200 when the same probe is down");
      const healthBody = JSON.parse(result.healthRaw) as {
        ok: boolean;
        database: { status: string };
      };
      assert.equal(healthBody.ok, true);
      assert.equal(healthBody.database.status, "down");
      assertNoSensitiveLeak(result.healthRaw, "unready /health body");

      // Captured stdout may include db_health_check_failed lifecycle lines and
      // request logs. They must not echo connection strings, probe credentials,
      // or raw driver / auth failure text.
      assertNoSensitiveLeak(captured, "captured route/lifecycle logs");
    } finally {
      await server.close();
      await closePool(pool);
    }
  });
});
