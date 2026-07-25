import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AppOptions } from "../../src/app";
import type { CorrelationService } from "../../src/correlation/service";
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

function tenantHeaders(extra: Record<string, string> = {}) {
  return {
    "x-tenant-id": TENANT_ID,
    ...extra,
  };
}

function stubCorrelation(
  overrides: Partial<CorrelationService> = {},
): CorrelationService {
  return {
    evaluateAfterIngest: async () => undefined,
    evaluateSilence: async () => ({
      evaluated: 0,
      created: 0,
      suppressed: 0,
    }),
    updateStatus: async () => ({ ok: false, reason: "not_found" }),
    list: async () => [],
    ...overrides,
  };
}

describe("GET /v1/findings", () => {
  it("requires an authenticated tenant principal", async () => {
    await withServer(
      { correlationService: stubCorrelation() },
      async (server) => {
        const res = await fetch(`${server.url}/v1/findings`);
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(body.error.code, "TENANT_REQUIRED");
      },
    );
  });

  it("fails closed with 503 when correlation is not wired", async () => {
    await withServer({}, async (server) => {
      const res = await fetch(`${server.url}/v1/findings`, {
        headers: tenantHeaders(),
      });
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.error.code, "FINDINGS_UNAVAILABLE");
    });
  });

  it("lists findings for a human operator", async () => {
    const createdAt = new Date("2026-03-01T12:00:00.000Z");
    await withServer(
      {
        correlationService: stubCorrelation({
          list: async (tenantId, query) => {
            assert.equal(tenantId, TENANT_ID);
            assert.equal(query.agentId, undefined);
            return [
              {
                id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                tenantId: TENANT_ID,
                agentId: AGENT_ID,
                ruleId: "agent.lifecycle_churn",
                title: "Agent lifecycle churn",
                severity: "medium",
                evidence: { totalInWindow: 6 },
                windowStart: new Date("2026-03-01T11:50:00.000Z"),
                windowEnd: new Date("2026-03-01T12:00:00.000Z"),
                windowBucket: new Date("2026-03-01T11:50:00.000Z"),
                createdAt,
                status: "open" as const,
                statusChangedAt: null,
                statusChangedByUserId: null,
              },
            ];
          },
        }),
      },
      async (server) => {
        const res = await fetch(`${server.url}/v1/findings`, {
          headers: tenantHeaders(),
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.ok, true);
        assert.equal(body.data.findings.length, 1);
        assert.equal(body.data.findings[0].ruleId, "agent.lifecycle_churn");
        assert.equal(body.data.findings[0].evidence.totalInWindow, 6);
        assert.equal(body.data.findings[0].status, "open");
        assert.equal(body.data.page.returned, 1);
      },
    );
  });

  it("scopes an agent principal and rejects foreign agentId", async () => {
    let called = false;
    await withServer(
      {
        correlationService: stubCorrelation({
          list: async (_tenantId, query) => {
            called = true;
            assert.equal(query.agentId, AGENT_ID);
            return [];
          },
        }),
      },
      async (server) => {
        const mismatch = await fetch(
          `${server.url}/v1/findings?agentId=${OTHER_AGENT}`,
          { headers: tenantHeaders({ "x-agent-id": AGENT_ID }) },
        );
        assert.equal(mismatch.status, 400);
        const mismatchBody = await mismatch.json();
        assert.equal(mismatchBody.error.code, "FINDINGS_REJECTED");
        assert.equal(called, false);

        const ok = await fetch(`${server.url}/v1/findings`, {
          headers: tenantHeaders({ "x-agent-id": AGENT_ID }),
        });
        assert.equal(ok.status, 200);
        assert.equal(called, true);
      },
    );
  });

  it("rejects tenantId in the query string", async () => {
    await withServer(
      { correlationService: stubCorrelation() },
      async (server) => {
        const res = await fetch(
          `${server.url}/v1/findings?tenantId=${TENANT_ID}`,
          { headers: tenantHeaders() },
        );
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(body.error.code, "FINDINGS_INVALID");
      },
    );
  });

  it("rejects invalid limit bounds", async () => {
    await withServer(
      { correlationService: stubCorrelation() },
      async (server) => {
        const res = await fetch(`${server.url}/v1/findings?limit=101`, {
          headers: tenantHeaders(),
        });
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(body.error.code, "FINDINGS_INVALID");
      },
    );
  });
});

describe("POST /v1/findings/evaluate-silence", () => {
  it("requires an authenticated tenant principal", async () => {
    await withServer(
      { correlationService: stubCorrelation() },
      async (server) => {
        const res = await fetch(`${server.url}/v1/findings/evaluate-silence`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(body.error.code, "TENANT_REQUIRED");
      },
    );
  });

  it("rejects agent principals", async () => {
    await withServer(
      { correlationService: stubCorrelation() },
      async (server) => {
        const res = await fetch(`${server.url}/v1/findings/evaluate-silence`, {
          method: "POST",
          headers: {
            ...tenantHeaders({ "x-agent-id": AGENT_ID }),
            "content-type": "application/json",
          },
          body: "{}",
        });
        assert.equal(res.status, 403);
        const body = await res.json();
        assert.equal(body.error.code, "FINDINGS_REJECTED");
      },
    );
  });

  it("rejects tenantId in the body", async () => {
    await withServer(
      { correlationService: stubCorrelation() },
      async (server) => {
        const res = await fetch(`${server.url}/v1/findings/evaluate-silence`, {
          method: "POST",
          headers: { ...tenantHeaders(), "content-type": "application/json" },
          body: JSON.stringify({ tenantId: TENANT_ID }),
        });
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(body.error.code, "FINDINGS_INVALID");
      },
    );
  });

  it("returns evaluate counts for an operator", async () => {
    await withServer(
      {
        correlationService: stubCorrelation({
          evaluateSilence: async (tenantId, options) => {
            assert.equal(tenantId, TENANT_ID);
            assert.equal(options?.agentId, AGENT_ID);
            return { evaluated: 1, created: 1, suppressed: 0 };
          },
        }),
      },
      async (server) => {
        const res = await fetch(`${server.url}/v1/findings/evaluate-silence`, {
          method: "POST",
          headers: { ...tenantHeaders(), "content-type": "application/json" },
          body: JSON.stringify({ agentId: AGENT_ID }),
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.ok, true);
        assert.deepEqual(body.data, {
          evaluated: 1,
          created: 1,
          suppressed: 0,
        });
      },
    );
  });
});

const FINDING_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

describe("PATCH /v1/findings/:id", () => {
  it("requires an authenticated tenant principal", async () => {
    await withServer(
      { correlationService: stubCorrelation() },
      async (server) => {
        const res = await fetch(`${server.url}/v1/findings/${FINDING_ID}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "acknowledged" }),
        });
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(body.error.code, "TENANT_REQUIRED");
      },
    );
  });

  it("rejects agent principals", async () => {
    await withServer(
      { correlationService: stubCorrelation() },
      async (server) => {
        const res = await fetch(`${server.url}/v1/findings/${FINDING_ID}`, {
          method: "PATCH",
          headers: {
            ...tenantHeaders({ "x-agent-id": AGENT_ID }),
            "content-type": "application/json",
          },
          body: JSON.stringify({ status: "acknowledged" }),
        });
        assert.equal(res.status, 403);
        const body = await res.json();
        assert.equal(body.error.code, "FINDINGS_REJECTED");
      },
    );
  });

  it("rejects tenantId in the body", async () => {
    await withServer(
      { correlationService: stubCorrelation() },
      async (server) => {
        const res = await fetch(`${server.url}/v1/findings/${FINDING_ID}`, {
          method: "PATCH",
          headers: { ...tenantHeaders(), "content-type": "application/json" },
          body: JSON.stringify({
            status: "acknowledged",
            tenantId: TENANT_ID,
          }),
        });
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(body.error.code, "FINDINGS_INVALID");
      },
    );
  });

  it("returns 404 for an unknown finding", async () => {
    await withServer(
      { correlationService: stubCorrelation() },
      async (server) => {
        const res = await fetch(`${server.url}/v1/findings/${FINDING_ID}`, {
          method: "PATCH",
          headers: { ...tenantHeaders(), "content-type": "application/json" },
          body: JSON.stringify({ status: "acknowledged" }),
        });
        assert.equal(res.status, 404);
        const body = await res.json();
        assert.equal(body.error.code, "FINDINGS_NOT_FOUND");
      },
    );
  });

  it("rejects an invalid transition", async () => {
    await withServer(
      {
        correlationService: stubCorrelation({
          updateStatus: async () => ({
            ok: false,
            reason: "invalid_transition",
            message: "transition from resolved to acknowledged is not allowed",
          }),
        }),
      },
      async (server) => {
        const res = await fetch(`${server.url}/v1/findings/${FINDING_ID}`, {
          method: "PATCH",
          headers: { ...tenantHeaders(), "content-type": "application/json" },
          body: JSON.stringify({ status: "acknowledged" }),
        });
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(body.error.code, "FINDINGS_INVALID");
      },
    );
  });

  it("updates status for an operator", async () => {
    const changedAt = new Date("2026-03-01T13:00:00.000Z");
    await withServer(
      {
        correlationService: stubCorrelation({
          updateStatus: async (tenantId, findingId, status) => {
            assert.equal(tenantId, TENANT_ID);
            assert.equal(findingId, FINDING_ID);
            assert.equal(status, "acknowledged");
            return {
              ok: true,
              finding: {
                id: FINDING_ID,
                tenantId: TENANT_ID,
                agentId: AGENT_ID,
                ruleId: "agent.heartbeat_silence",
                title: "Agent heartbeat silence",
                severity: "medium",
                evidence: {},
                windowStart: new Date("2026-03-01T12:00:00.000Z"),
                windowEnd: new Date("2026-03-01T12:05:00.000Z"),
                windowBucket: new Date("2026-03-01T12:00:00.000Z"),
                createdAt: new Date("2026-03-01T12:05:00.000Z"),
                status: "acknowledged",
                statusChangedAt: changedAt,
                statusChangedByUserId: null,
              },
            };
          },
        }),
      },
      async (server) => {
        const res = await fetch(`${server.url}/v1/findings/${FINDING_ID}`, {
          method: "PATCH",
          headers: { ...tenantHeaders(), "content-type": "application/json" },
          body: JSON.stringify({ status: "acknowledged" }),
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.data.finding.status, "acknowledged");
        assert.equal(
          body.data.finding.statusChangedAt,
          changedAt.toISOString(),
        );
      },
    );
  });
});
