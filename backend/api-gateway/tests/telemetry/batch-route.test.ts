import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AppOptions } from "../../src/app";
import type {
  IngestBatchOutcome,
  TelemetryService,
} from "../../src/telemetry/service";
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

function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    eventType: "heartbeat",
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
}

function stubService(
  overrides: Partial<TelemetryService> = {},
): TelemetryService {
  return {
    ingest: async () => ({
      ok: true,
      event: {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        ingestedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    }),
    ingestBatch: async (_tenantId, events) => ({
      ok: true,
      events: events.map((_, i) => ({
        id: `cccccccc-cccc-4ccc-8ccc-ccccccccccc${i}`,
        ingestedAt: new Date("2026-01-01T00:00:00.000Z"),
      })),
    }),
    query: async () => ({
      ok: true,
      result: {
        events: [],
        summary: {
          agentId: AGENT_ID,
          lastSeenAt: null,
          lastHeartbeatAt: null,
          countsByEventType: {},
          totalInWindow: 0,
        },
      },
    }),
    ...overrides,
  };
}

describe("POST /v1/telemetry/events/batch", () => {
  it("requires agent authentication", async () => {
    await withServer({ telemetryService: stubService() }, async (server) => {
      const res = await fetch(`${server.url}/v1/telemetry/events/batch`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tenant-id": TENANT_ID,
        },
        body: JSON.stringify({ events: [validEvent()] }),
      });
      const body = await res.json();
      assert.equal(res.status, 401);
      assert.equal(body.error.code, "AGENT_AUTH_REQUIRED");
    });
  });

  it("accepts a multi-event batch", async () => {
    let seenCount = 0;
    let seenTenant: string | undefined;
    let seenAgent: string | undefined;

    await withServer(
      {
        telemetryService: stubService({
          ingestBatch: async (tenantId, events) => {
            seenTenant = tenantId;
            seenCount = events.length;
            seenAgent = events[0]?.agentId;
            return {
              ok: true,
              events: events.map((_, i) => ({
                id: `dddddddd-dddd-4ddd-8ddd-ddddddddddd${i}`,
                ingestedAt: new Date("2026-01-02T00:00:00.000Z"),
              })),
            } satisfies IngestBatchOutcome;
          },
        }),
      },
      async (server) => {
        const res = await fetch(`${server.url}/v1/telemetry/events/batch`, {
          method: "POST",
          headers: agentHeaders(),
          body: JSON.stringify({
            events: [validEvent(), validEvent({ eventType: "agent.started" })],
          }),
        });
        const body = await res.json();

        assert.equal(res.status, 201);
        assert.equal(body.data.accepted, 2);
        assert.equal(body.data.events.length, 2);
        assert.equal(seenCount, 2);
        assert.equal(seenTenant, TENANT_ID);
        assert.equal(seenAgent, AGENT_ID);
      },
    );
  });

  it("rejects batches over the configured max (all-or-nothing)", async () => {
    await withServer(
      { telemetryService: stubService(), telemetryBatchMaxEvents: 2 },
      async (server) => {
        const res = await fetch(`${server.url}/v1/telemetry/events/batch`, {
          method: "POST",
          headers: agentHeaders(),
          body: JSON.stringify({
            events: [validEvent(), validEvent(), validEvent()],
          }),
        });
        const body = await res.json();
        assert.equal(res.status, 400);
        assert.equal(body.error.code, "TELEMETRY_INVALID");
        assert.match(body.error.message, /max of 2/i);
      },
    );
  });

  it("rejects a mixed-validity batch without calling ingest", async () => {
    let called = false;
    await withServer(
      {
        telemetryService: stubService({
          ingestBatch: async () => {
            called = true;
            return { ok: true, events: [] };
          },
        }),
      },
      async (server) => {
        const res = await fetch(`${server.url}/v1/telemetry/events/batch`, {
          method: "POST",
          headers: agentHeaders(),
          body: JSON.stringify({
            events: [
              validEvent(),
              validEvent({ eventType: "malware.detected" }),
            ],
          }),
        });
        const body = await res.json();
        assert.equal(res.status, 400);
        assert.equal(body.error.code, "TELEMETRY_INVALID");
        assert.equal(called, false);
      },
    );
  });

  it("rejects body agentId that does not match the principal", async () => {
    await withServer({ telemetryService: stubService() }, async (server) => {
      const res = await fetch(`${server.url}/v1/telemetry/events/batch`, {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify({
          events: [validEvent({ agentId: OTHER_AGENT })],
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 400);
      assert.equal(body.error.code, "TELEMETRY_REJECTED");
    });
  });

  it("maps unknown agent to TELEMETRY_REJECTED", async () => {
    await withServer(
      {
        telemetryService: stubService({
          ingestBatch: async () =>
            ({ ok: false, reason: "agent_not_found" }) satisfies IngestBatchOutcome,
        }),
      },
      async (server) => {
        const res = await fetch(`${server.url}/v1/telemetry/events/batch`, {
          method: "POST",
          headers: agentHeaders(),
          body: JSON.stringify({ events: [validEvent()] }),
        });
        const body = await res.json();
        assert.equal(res.status, 400);
        assert.equal(body.error.code, "TELEMETRY_REJECTED");
      },
    );
  });
});
