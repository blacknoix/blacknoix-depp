import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AppOptions } from "../../src/app";
import type { TelemetryEventV1 } from "../../src/telemetry/contract";
import type { IngestOutcome, TelemetryService } from "../../src/telemetry/service";
import { startTestServer, type TestServer } from "../helpers/test-server";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_AGENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function withServer(
  options: AppOptions,
  run: (server: TestServer) => Promise<void>,
): Promise<void> {
  const server = await startTestServer(options);
  try {
    await run(server);
  } finally {
    await server.close();
  }
}

function agentHeaders(extra: Record<string, string> = {}) {
  return {
    "content-type": "application/json",
    "x-tenant-id": TENANT_ID,
    "x-agent-id": AGENT_ID,
    ...extra,
  };
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    agentId: AGENT_ID,
    eventType: "heartbeat",
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
}

function stubService(
  impl?: (tenantId: string, event: TelemetryEventV1) => Promise<IngestOutcome>,
): TelemetryService {
  return {
    ingest:
      impl ??
      (async () => ({
        ok: true,
        event: {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          ingestedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      })),
    ingestBatch: async () => ({
      ok: true,
      events: [],
    }),
    query: async () => ({ ok: false, reason: "agent_not_found" }),
  };
}

describe("POST /v1/telemetry/events", () => {
  it("requires an authenticated tenant principal", async () => {
    await withServer({ telemetryService: stubService() }, async (server) => {
      const res = await fetch(`${server.url}/v1/telemetry/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validBody()),
      });
      const body = await res.json();

      assert.equal(res.status, 400);
      assert.equal(body.ok, false);
      assert.equal(body.error.code, "TENANT_REQUIRED");
    });
  });

  it("requires an agent principal, not tenant-only auth", async () => {
    await withServer({ telemetryService: stubService() }, async (server) => {
      const res = await fetch(`${server.url}/v1/telemetry/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tenant-id": TENANT_ID,
        },
        body: JSON.stringify(validBody()),
      });
      const body = await res.json();

      assert.equal(res.status, 401);
      assert.equal(body.error.code, "AGENT_AUTH_REQUIRED");
    });
  });

  it("fails closed with 503 when telemetry is not wired", async () => {
    await withServer({}, async (server) => {
      const res = await fetch(`${server.url}/v1/telemetry/events`, {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify(validBody()),
      });
      const body = await res.json();

      assert.equal(res.status, 503);
      assert.equal(body.error.code, "TELEMETRY_UNAVAILABLE");
    });
  });

  it("rejects malformed payloads with TELEMETRY_INVALID", async () => {
    await withServer({ telemetryService: stubService() }, async (server) => {
      const res = await fetch(`${server.url}/v1/telemetry/events`, {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify(validBody({ eventType: "malware.detected" })),
      });
      const body = await res.json();

      assert.equal(res.status, 400);
      assert.equal(body.error.code, "TELEMETRY_INVALID");
    });
  });

  it("rejects tenantId in the body", async () => {
    await withServer({ telemetryService: stubService() }, async (server) => {
      const res = await fetch(`${server.url}/v1/telemetry/events`, {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify(validBody({ tenantId: TENANT_ID })),
      });
      const body = await res.json();

      assert.equal(res.status, 400);
      assert.equal(body.error.code, "TELEMETRY_INVALID");
      assert.match(body.error.message, /tenant identity/i);
    });
  });

  it("rejects a body agentId that does not match the principal", async () => {
    await withServer({ telemetryService: stubService() }, async (server) => {
      const res = await fetch(`${server.url}/v1/telemetry/events`, {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify(validBody({ agentId: OTHER_AGENT })),
      });
      const body = await res.json();

      assert.equal(res.status, 400);
      assert.equal(body.error.code, "TELEMETRY_REJECTED");
    });
  });

  it("binds agentId from the principal when omitted from the body", async () => {
    let seenAgent: string | undefined;

    await withServer(
      {
        telemetryService: stubService(async (_tenantId, event) => {
          seenAgent = event.agentId;
          return {
            ok: true,
            event: {
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              ingestedAt: new Date("2026-01-01T00:00:00.000Z"),
            },
          };
        }),
      },
      async (server) => {
        const { agentId: _omit, ...withoutAgent } = validBody();
        const res = await fetch(`${server.url}/v1/telemetry/events`, {
          method: "POST",
          headers: agentHeaders(),
          body: JSON.stringify(withoutAgent),
        });
        assert.equal(res.status, 201);
        assert.equal(seenAgent, AGENT_ID);
      },
    );
  });

  it("returns 201 with the success envelope on accept", async () => {
    let seenTenant: string | undefined;

    await withServer(
      {
        telemetryService: stubService(async (tenantId) => {
          seenTenant = tenantId;
          return {
            ok: true,
            event: {
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              ingestedAt: new Date("2026-01-01T00:00:00.000Z"),
            },
          };
        }),
      },
      async (server) => {
        const res = await fetch(`${server.url}/v1/telemetry/events`, {
          method: "POST",
          headers: agentHeaders(),
          body: JSON.stringify(validBody()),
        });
        const body = await res.json();

        assert.equal(res.status, 201);
        assert.equal(body.ok, true);
        assert.deepEqual(body.data, {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          ingestedAt: "2026-01-01T00:00:00.000Z",
        });
        assert.equal(typeof body.requestId, "string");
        assert.equal(seenTenant, TENANT_ID);
      },
    );
  });

  it("maps unknown agent to non-oracular TELEMETRY_REJECTED", async () => {
    await withServer(
      {
        telemetryService: stubService(async () => ({
          ok: false,
          reason: "agent_not_found",
        })),
      },
      async (server) => {
        const res = await fetch(`${server.url}/v1/telemetry/events`, {
          method: "POST",
          headers: agentHeaders(),
          body: JSON.stringify(validBody()),
        });
        const body = await res.json();

        assert.equal(res.status, 400);
        assert.equal(body.error.code, "TELEMETRY_REJECTED");
        assert.equal(body.error.message, "Telemetry event cannot be accepted");
      },
    );
  });

  it("scopes ingest to the principal tenant, not a body claim", async () => {
    let seenTenant: string | undefined;

    await withServer(
      {
        telemetryService: stubService(async (tenantId) => {
          seenTenant = tenantId;
          return {
            ok: true,
            event: {
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              ingestedAt: new Date("2026-01-01T00:00:00.000Z"),
            },
          };
        }),
      },
      async (server) => {
        const otherTenant = "22222222-2222-4222-8222-222222222222";
        await fetch(`${server.url}/v1/telemetry/events`, {
          method: "POST",
          headers: agentHeaders({ "x-tenant-id": otherTenant }),
          body: JSON.stringify(validBody()),
        });

        assert.equal(seenTenant, otherTenant);
      },
    );
  });
});
