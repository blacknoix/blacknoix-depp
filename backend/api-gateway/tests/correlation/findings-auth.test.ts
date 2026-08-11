import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { CorrelationService } from "../../src/correlation/service";
import {
  configureExplicitRolesMode,
  resetImplicitOperatorCompatWarnState,
} from "../../src/auth/roles";
import { startTestServer } from "../helpers/test-server";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FINDING_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

afterEach(() => {
  configureExplicitRolesMode("compat");
  resetImplicitOperatorCompatWarnState();
});

function stubCorrelation(): CorrelationService {
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
  };
}

const PATHS = [
  { method: "GET", path: "/v1/findings" },
  { method: "GET", path: "/v1/findings/dashboard" },
  { method: "GET", path: "/v1/findings/attention" },
  {
    method: "POST",
    path: "/v1/findings/evaluate-silence",
    body: JSON.stringify({}),
  },
  { method: "GET", path: "/v1/findings/suppressions" },
  {
    method: "POST",
    path: "/v1/findings/suppressions",
    body: JSON.stringify({
      ruleId: "agent.heartbeat_silence",
      endsAt: "2099-01-01T00:00:00.000Z",
    }),
  },
  {
    method: "DELETE",
    path: `/v1/findings/suppressions/${FINDING_ID}`,
  },
  { method: "GET", path: "/v1/findings/views" },
  {
    method: "PATCH",
    path: `/v1/findings/${FINDING_ID}`,
    body: JSON.stringify({ status: "acknowledged" }),
  },
] as const;

describe("findings explicit-role authorization", () => {
  it("compat: empty-role human can list; enforce denies empty/unsupported/auditor consistently", async () => {
    const server = await startTestServer({
      correlationService: stubCorrelation(),
      sharedViews: {
        list: async () => [],
        insert: async () => ({ ok: false, reason: "conflict" }),
        deleteById: async () => undefined,
      },
    });

    try {
      configureExplicitRolesMode("compat");
      const compatList = await fetch(`${server.url}/v1/findings`, {
        headers: { "x-tenant-id": TENANT_ID },
      });
      assert.equal(compatList.status, 200);

      configureExplicitRolesMode("enforce");
      for (const roleCase of [
        { label: "missing", headers: { "x-tenant-id": TENANT_ID } as Record<string, string> },
        {
          label: "unsupported",
          headers: { "x-tenant-id": TENANT_ID, "x-roles": "admin" } as Record<
            string,
            string
          >,
        },
        {
          label: "auditor",
          headers: { "x-tenant-id": TENANT_ID, "x-roles": "auditor" } as Record<
            string,
            string
          >,
        },
      ]) {
        for (const route of PATHS) {
          const headers: Record<string, string> = { ...roleCase.headers };
          if ("body" in route && route.body) {
            headers["content-type"] = "application/json";
          }
          const res = await fetch(`${server.url}${route.path}`, {
            method: route.method,
            headers,
            body: "body" in route ? route.body : undefined,
          });
          assert.equal(
            res.status,
            403,
            `${roleCase.label} ${route.method} ${route.path}`,
          );
          assert.equal(
            (await res.json()).error.code,
            "FINDINGS_REJECTED",
            `${roleCase.label} ${route.method} ${route.path}`,
          );
        }
      }

      const opHeaders = {
        "x-tenant-id": TENANT_ID,
        "x-roles": "operator",
      };
      const opList = await fetch(`${server.url}/v1/findings`, {
        headers: opHeaders,
      });
      assert.equal(opList.status, 200);
      const opDash = await fetch(`${server.url}/v1/findings/dashboard`, {
        headers: opHeaders,
      });
      assert.equal(opDash.status, 200);

      const agentList = await fetch(`${server.url}/v1/findings`, {
        headers: {
          "x-tenant-id": TENANT_ID,
          "x-agent-id": AGENT_ID,
        },
      });
      assert.equal(agentList.status, 200);

      const agentDash = await fetch(`${server.url}/v1/findings/dashboard`, {
        headers: {
          "x-tenant-id": TENANT_ID,
          "x-agent-id": AGENT_ID,
        },
      });
      assert.equal(agentDash.status, 403);
    } finally {
      await server.close();
    }
  });
});
