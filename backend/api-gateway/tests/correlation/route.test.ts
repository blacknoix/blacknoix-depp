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
    patchFinding: async () => ({ ok: false, reason: "not_found" }),
    createSuppression: async () => ({ ok: false, reason: "conflict" }),
    clearSuppression: async () => ({ ok: false, reason: "not_found" }),
    listSuppressions: async () => [],
    list: async () => [],
    dashboard: async () => ({
      generatedAt: new Date("2026-03-01T12:00:00.000Z"),
      windowHours: 24,
      countsByStatus: { open: 0, acknowledged: 0, resolved: 0 },
      countsByRuleId: {
        "agent.lifecycle_churn": 0,
        "agent.heartbeat_burst": 0,
        "agent.heartbeat_silence": 0,
      },
      recentCreatedCount: 0,
      recentChangedCount: 0,
      activeSuppressionCount: 0,
    }),
    attention: async () => ({
      generatedAt: new Date("2026-03-01T12:00:00.000Z"),
      since: new Date("2026-02-28T12:00:00.000Z"),
      maxLookbackHours: 24,
      openCount: 0,
      activeSuppressionCount: 0,
      items: [],
      truncated: false,
    }),
    ...overrides,
  };
}

function emptyIntentFields() {
  return {
    ownerUserId: null as string | null,
    ownerChangedAt: null as Date | null,
    ownerChangedByUserId: null as string | null,
    operatorNote: null as string | null,
    operatorNoteUpdatedAt: null as Date | null,
    operatorNoteUpdatedByUserId: null as string | null,
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
                ...emptyIntentFields(),
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

describe("GET /v1/findings/dashboard", () => {
  it("rejects agent principals", async () => {
    await withServer(
      { correlationService: stubCorrelation() },
      async (server) => {
        const res = await fetch(`${server.url}/v1/findings/dashboard`, {
          headers: tenantHeaders({ "x-agent-id": AGENT_ID }),
        });
        assert.equal(res.status, 403);
        const body = await res.json();
        assert.equal(body.error.code, "FINDINGS_REJECTED");
      },
    );
  });

  it("rejects query parameters and returns the operator summary", async () => {
    const generatedAt = new Date("2026-03-01T12:00:00.000Z");
    await withServer(
      {
        correlationService: stubCorrelation({
          dashboard: async (tenantId) => {
            assert.equal(tenantId, TENANT_ID);
            return {
              generatedAt,
              windowHours: 24,
              countsByStatus: { open: 2, acknowledged: 1, resolved: 0 },
              countsByRuleId: {
                "agent.lifecycle_churn": 2,
                "agent.heartbeat_burst": 1,
                "agent.heartbeat_silence": 0,
              },
              recentCreatedCount: 3,
              recentChangedCount: 1,
              activeSuppressionCount: 1,
            };
          },
        }),
      },
      async (server) => {
        const bad = await fetch(
          `${server.url}/v1/findings/dashboard?hours=48`,
          { headers: tenantHeaders() },
        );
        assert.equal(bad.status, 400);

        const res = await fetch(`${server.url}/v1/findings/dashboard`, {
          headers: tenantHeaders(),
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.ok, true);
        assert.equal(body.data.generatedAt, generatedAt.toISOString());
        assert.deepEqual(body.data.window, { hours: 24 });
        assert.deepEqual(body.data.countsByStatus, {
          open: 2,
          acknowledged: 1,
          resolved: 0,
        });
        assert.equal(body.data.recentCreatedCount, 3);
        assert.equal(body.data.activeSuppressionCount, 1);
      },
    );
  });
});

describe("GET /v1/findings/attention", () => {
  it("rejects agent principals", async () => {
    await withServer(
      { correlationService: stubCorrelation() },
      async (server) => {
        const res = await fetch(`${server.url}/v1/findings/attention`, {
          headers: tenantHeaders({ "x-agent-id": AGENT_ID }),
        });
        assert.equal(res.status, 403);
        const body = await res.json();
        assert.equal(body.error.code, "FINDINGS_REJECTED");
      },
    );
  });

  it("rejects bad since and returns operator digest items", async () => {
    const generatedAt = new Date("2026-03-01T12:00:00.000Z");
    const since = new Date("2026-03-01T10:00:00.000Z");
    await withServer(
      {
        correlationService: stubCorrelation({
          attention: async (tenantId, requestedSince) => {
            assert.equal(tenantId, TENANT_ID);
            assert.equal(
              requestedSince?.toISOString(),
              "2026-03-01T10:00:00.000Z",
            );
            return {
              generatedAt,
              since,
              maxLookbackHours: 24,
              openCount: 2,
              activeSuppressionCount: 1,
              truncated: false,
              items: [
                {
                  kind: "finding.created",
                  findingId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                  title: "Agent lifecycle churn",
                  status: "open",
                  ruleId: "agent.lifecycle_churn",
                  agentId: AGENT_ID,
                  at: new Date("2026-03-01T11:00:00.000Z"),
                },
              ],
            };
          },
        }),
      },
      async (server) => {
        const bad = await fetch(
          `${server.url}/v1/findings/attention?since=not-iso`,
          { headers: tenantHeaders() },
        );
        assert.equal(bad.status, 400);

        const res = await fetch(
          `${server.url}/v1/findings/attention?since=2026-03-01T10:00:00.000Z`,
          { headers: tenantHeaders() },
        );
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.ok, true);
        assert.equal(body.data.generatedAt, generatedAt.toISOString());
        assert.equal(body.data.since, since.toISOString());
        assert.equal(body.data.openCount, 2);
        assert.equal(body.data.items.length, 1);
        assert.equal(body.data.items[0].kind, "finding.created");
        assert.equal(
          body.data.items[0].findingId,
          "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        );
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
          patchFinding: async () => ({
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
          patchFinding: async (tenantId, findingId, patch) => {
            assert.equal(tenantId, TENANT_ID);
            assert.equal(findingId, FINDING_ID);
            assert.equal(patch.status, "acknowledged");
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
                ...emptyIntentFields(),
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

  const USER_ID = "22222222-2222-4222-8222-222222222222";

  it("claims and clears ownership with operator identity", async () => {
    let owner: string | null = null;
    await withServer(
      {
        correlationService: stubCorrelation({
          patchFinding: async (_t, _id, patch, actor) => {
            assert.equal(actor.userId, USER_ID);
            if (patch.claimOwner === true) {
              owner = USER_ID;
            } else if ("ownerUserId" in patch) {
              owner = patch.ownerUserId ?? null;
            }
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
                status: "open",
                statusChangedAt: null,
                statusChangedByUserId: null,
                ...emptyIntentFields(),
                ownerUserId: owner,
                ownerChangedAt: new Date("2026-03-01T13:00:00.000Z"),
                ownerChangedByUserId: USER_ID,
              },
            };
          },
        }),
      },
      async (server) => {
        const claim = await fetch(`${server.url}/v1/findings/${FINDING_ID}`, {
          method: "PATCH",
          headers: {
            ...tenantHeaders({ "x-user-id": USER_ID }),
            "content-type": "application/json",
          },
          body: JSON.stringify({ claimOwner: true }),
        });
        assert.equal(claim.status, 200);
        assert.equal((await claim.json()).data.finding.ownerUserId, USER_ID);

        const clear = await fetch(`${server.url}/v1/findings/${FINDING_ID}`, {
          method: "PATCH",
          headers: {
            ...tenantHeaders({ "x-user-id": USER_ID }),
            "content-type": "application/json",
          },
          body: JSON.stringify({ ownerUserId: null }),
        });
        assert.equal(clear.status, 200);
        assert.equal((await clear.json()).data.finding.ownerUserId, null);
      },
    );
  });

  it("rejects claim without operator identity", async () => {
    await withServer(
      {
        correlationService: stubCorrelation({
          patchFinding: async () => ({
            ok: false,
            reason: "rejected",
            message: "Operator identity is required to claim ownership",
          }),
        }),
      },
      async (server) => {
        const res = await fetch(`${server.url}/v1/findings/${FINDING_ID}`, {
          method: "PATCH",
          headers: { ...tenantHeaders(), "content-type": "application/json" },
          body: JSON.stringify({ claimOwner: true }),
        });
        assert.equal(res.status, 403);
        const body = await res.json();
        assert.equal(body.error.code, "FINDINGS_REJECTED");
      },
    );
  });

  it("sets and clears the current operator note", async () => {
    await withServer(
      {
        correlationService: stubCorrelation({
          patchFinding: async (_t, _id, patch) => {
            assert.ok("operatorNote" in patch);
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
                status: "open",
                statusChangedAt: null,
                statusChangedByUserId: null,
                ...emptyIntentFields(),
                operatorNote: patch.operatorNote ?? null,
                operatorNoteUpdatedAt: new Date("2026-03-01T13:00:00.000Z"),
              },
            };
          },
        }),
      },
      async (server) => {
        const set = await fetch(`${server.url}/v1/findings/${FINDING_ID}`, {
          method: "PATCH",
          headers: { ...tenantHeaders(), "content-type": "application/json" },
          body: JSON.stringify({ operatorNote: "Likely false positive" }),
        });
        assert.equal(set.status, 200);
        assert.equal(
          (await set.json()).data.finding.operatorNote,
          "Likely false positive",
        );

        const clear = await fetch(`${server.url}/v1/findings/${FINDING_ID}`, {
          method: "PATCH",
          headers: { ...tenantHeaders(), "content-type": "application/json" },
          body: JSON.stringify({ operatorNote: null }),
        });
        assert.equal(clear.status, 200);
        assert.equal((await clear.json()).data.finding.operatorNote, null);
      },
    );
  });
});

describe("POST /v1/findings/suppressions", () => {
  it("rejects agent principals", async () => {
    await withServer(
      { correlationService: stubCorrelation() },
      async (server) => {
        const res = await fetch(`${server.url}/v1/findings/suppressions`, {
          method: "POST",
          headers: {
            ...tenantHeaders({ "x-agent-id": AGENT_ID }),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            ruleId: "agent.lifecycle_churn",
            until: "2099-01-01T00:00:00.000Z",
          }),
        });
        assert.equal(res.status, 403);
      },
    );
  });

  it("rejects invalid windows and creates a valid snooze", async () => {
    const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await withServer(
      {
        correlationService: stubCorrelation({
          createSuppression: async (tenantId, input) => {
            assert.equal(tenantId, TENANT_ID);
            assert.equal(input.ruleId, "agent.heartbeat_silence");
            return {
              ok: true,
              suppression: {
                id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                tenantId: TENANT_ID,
                ruleId: input.ruleId,
                startsAt: input.startsAt,
                endsAt: input.endsAt,
                createdAt: input.startsAt,
                createdByUserId: null,
                clearedAt: null,
                clearedByUserId: null,
              },
            };
          },
        }),
      },
      async (server) => {
        const bad = await fetch(`${server.url}/v1/findings/suppressions`, {
          method: "POST",
          headers: { ...tenantHeaders(), "content-type": "application/json" },
          body: JSON.stringify({
            ruleId: "agent.lifecycle_churn",
            until: "2000-01-01T00:00:00.000Z",
          }),
        });
        assert.equal(bad.status, 400);

        const ok = await fetch(`${server.url}/v1/findings/suppressions`, {
          method: "POST",
          headers: { ...tenantHeaders(), "content-type": "application/json" },
          body: JSON.stringify({
            ruleId: "agent.heartbeat_silence",
            until,
          }),
        });
        assert.equal(ok.status, 201);
        const body = await ok.json();
        assert.equal(body.data.suppression.ruleId, "agent.heartbeat_silence");
      },
    );
  });
});

describe("DELETE /v1/findings/suppressions/:id", () => {
  it("returns 404 for unknown and clears when present", async () => {
    const id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    await withServer(
      {
        correlationService: stubCorrelation({
          clearSuppression: async (_tenantId, suppressionId) => {
            if (suppressionId !== id) {
              return { ok: false, reason: "not_found" };
            }
            return {
              ok: true,
              suppression: {
                id,
                tenantId: TENANT_ID,
                ruleId: "agent.lifecycle_churn",
                startsAt: new Date("2026-03-01T12:00:00.000Z"),
                endsAt: new Date("2026-03-02T12:00:00.000Z"),
                createdAt: new Date("2026-03-01T12:00:00.000Z"),
                createdByUserId: null,
                clearedAt: new Date("2026-03-01T13:00:00.000Z"),
                clearedByUserId: null,
              },
            };
          },
        }),
      },
      async (server) => {
        const missing = await fetch(
          `${server.url}/v1/findings/suppressions/ffffffff-ffff-4fff-8fff-ffffffffffff`,
          {
            method: "DELETE",
            headers: tenantHeaders(),
          },
        );
        assert.equal(missing.status, 404);

        const cleared = await fetch(
          `${server.url}/v1/findings/suppressions/${id}`,
          { method: "DELETE", headers: tenantHeaders() },
        );
        assert.equal(cleared.status, 200);
        const body = await cleared.json();
        assert.ok(body.data.suppression.clearedAt);
      },
    );
  });
});
