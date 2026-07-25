import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AppOptions } from "../../src/app";
import type {
  QueryOutcome,
  TelemetryService,
} from "../../src/telemetry/service";
import { startTestServer, type TestServer } from "../helpers/test-server";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
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

function tenantHeaders(extra: Record<string, string> = {}) {
  return {
    "x-tenant-id": TENANT_ID,
    ...extra,
  };
}

function agentHeaders(extra: Record<string, string> = {}) {
  return tenantHeaders({
    "x-agent-id": AGENT_ID,
    ...extra,
  });
}

function emptyResult(agentId: string = AGENT_ID): QueryOutcome {
  return {
    ok: true,
    result: {
      events: [],
      summary: {
        agentId,
        lastSeenAt: null,
        lastHeartbeatAt: null,
        countsByEventType: {},
        totalInWindow: 0,
      },
    },
  };
}

function stubService(
  overrides: Partial<TelemetryService> = {},
): TelemetryService {
  return {
    ingest: async () => ({
      ok: true,
      event: {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        ingestedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    }),
    ingestBatch: async () => ({ ok: true, events: [] }),
    query: async () => emptyResult(),
    ...overrides,
  };
}

describe("GET /v1/telemetry/events", () => {
  it("requires an authenticated tenant principal", async () => {
    await withServer({ telemetryService: stubService() }, async (server) => {
      const res = await fetch(
        `${server.url}/v1/telemetry/events?agentId=${AGENT_ID}`,
      );
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error.code, "TENANT_REQUIRED");
    });
  });

  it("requires agentId for a human principal", async () => {
    await withServer({ telemetryService: stubService() }, async (server) => {
      const res = await fetch(`${server.url}/v1/telemetry/events`, {
        headers: tenantHeaders(),
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error.code, "TELEMETRY_INVALID");
    });
  });

  it("lists events and summary for a human operator scoped by agentId", async () => {
    const occurredAt = new Date("2026-02-01T12:00:00.000Z");
    const ingestedAt = new Date("2026-02-01T12:00:01.000Z");

    await withServer(
      {
        telemetryService: stubService({
          query: async (tenantId, query) => {
            assert.equal(tenantId, TENANT_ID);
            assert.equal(query.agentId, AGENT_ID);
            return {
              ok: true,
              result: {
                events: [
                  {
                    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                    tenantId: TENANT_ID,
                    agentId: AGENT_ID,
                    schemaVersion: 1,
                    eventType: "heartbeat",
                    occurredAt,
                    ingestedAt,
                    payload: { status: "ok" },
                  },
                ],
                summary: {
                  agentId: AGENT_ID,
                  lastSeenAt: ingestedAt,
                  lastHeartbeatAt: occurredAt,
                  countsByEventType: { heartbeat: 1 },
                  totalInWindow: 1,
                },
              },
            };
          },
        }),
      },
      async (server) => {
        const res = await fetch(
          `${server.url}/v1/telemetry/events?agentId=${AGENT_ID}&limit=10`,
          { headers: tenantHeaders() },
        );
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.ok, true);
        assert.equal(body.data.events.length, 1);
        assert.equal(body.data.events[0].eventType, "heartbeat");
        assert.equal(body.data.summary.totalInWindow, 1);
        assert.equal(body.data.summary.countsByEventType.heartbeat, 1);
        assert.equal(body.data.page.limit, 10);
        assert.equal(body.data.page.returned, 1);
      },
    );
  });

  it("scopes an agent principal to itself and rejects foreign agentId", async () => {
    let called = false;
    await withServer(
      {
        telemetryService: stubService({
          query: async () => {
            called = true;
            return emptyResult();
          },
        }),
      },
      async (server) => {
        const mismatch = await fetch(
          `${server.url}/v1/telemetry/events?agentId=${OTHER_AGENT}`,
          { headers: agentHeaders() },
        );
        assert.equal(mismatch.status, 400);
        const mismatchBody = await mismatch.json();
        assert.equal(mismatchBody.error.code, "TELEMETRY_REJECTED");
        assert.equal(called, false);

        const ok = await fetch(`${server.url}/v1/telemetry/events`, {
          headers: agentHeaders(),
        });
        assert.equal(ok.status, 200);
        assert.equal(called, true);
      },
    );
  });

  it("rejects invalid limit bounds", async () => {
    await withServer({ telemetryService: stubService() }, async (server) => {
      const res = await fetch(
        `${server.url}/v1/telemetry/events?agentId=${AGENT_ID}&limit=101`,
        { headers: tenantHeaders() },
      );
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error.code, "TELEMETRY_INVALID");
    });
  });

  it("returns a non-oracular empty page for unknown agents", async () => {
    await withServer(
      {
        telemetryService: stubService({
          query: async () => ({ ok: false, reason: "agent_not_found" }),
        }),
      },
      async (server) => {
        const res = await fetch(
          `${server.url}/v1/telemetry/events?agentId=${OTHER_AGENT}`,
          { headers: tenantHeaders() },
        );
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.data.events.length, 0);
        assert.equal(body.data.summary.totalInWindow, 0);
        assert.equal(body.data.summary.lastSeenAt, null);
        assert.equal(body.data.summary.agentId, OTHER_AGENT);
      },
    );
  });

  it("does not accept tenantId from the query string", async () => {
    await withServer({ telemetryService: stubService() }, async (server) => {
      const res = await fetch(
        `${server.url}/v1/telemetry/events?agentId=${AGENT_ID}&tenantId=${OTHER_TENANT}`,
        { headers: tenantHeaders() },
      );
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error.code, "TELEMETRY_INVALID");
    });
  });

  it("passes the authenticated tenant to the service, not a query override", async () => {
    let seenTenant: string | undefined;
    await withServer(
      {
        telemetryService: stubService({
          query: async (tenantId) => {
            seenTenant = tenantId;
            return emptyResult();
          },
        }),
      },
      async (server) => {
        const res = await fetch(
          `${server.url}/v1/telemetry/events?agentId=${AGENT_ID}`,
          { headers: tenantHeaders({ "x-tenant-id": TENANT_ID }) },
        );
        assert.equal(res.status, 200);
        assert.equal(seenTenant, TENANT_ID);
      },
    );
  });
});
