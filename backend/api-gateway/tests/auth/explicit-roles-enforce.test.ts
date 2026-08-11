import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  applyExplicitRolesModeFromEnv,
  configureExplicitRolesMode,
  resetImplicitOperatorCompatWarnState,
} from "../../src/auth/roles";
import type { CorrelationService } from "../../src/correlation/service";
import { startTestServer } from "../helpers/test-server";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

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

describe("AUTH_EXPLICIT_ROLES_MODE=enforce route denials", () => {
  it("denies missing/empty/unsupported human roles on findings and tenants/me", async () => {
    applyExplicitRolesModeFromEnv("enforce");

    const server = await startTestServer({
      correlationService: stubCorrelation(),
      lookupTenant: async (id) => ({ id, slug: "acme", name: "Acme" }),
    });

    try {
      const denialCases: Array<{
        label: string;
        headers: Record<string, string>;
      }> = [
        { label: "missing", headers: { "x-tenant-id": TENANT_ID } },
        {
          label: "empty-x-roles",
          headers: { "x-tenant-id": TENANT_ID, "x-roles": "" },
        },
        {
          label: "unsupported-only",
          headers: { "x-tenant-id": TENANT_ID, "x-roles": "admin" },
        },
      ];

      for (const { label, headers } of denialCases) {
        const me = await fetch(`${server.url}/v1/tenants/me`, { headers });
        assert.equal(me.status, 403, label);
        assert.equal((await me.json()).error.code, "TENANT_SELF_REJECTED", label);

        const findings = await fetch(`${server.url}/v1/findings`, { headers });
        assert.equal(findings.status, 403, label);
        assert.equal(
          (await findings.json()).error.code,
          "FINDINGS_REJECTED",
          label,
        );
      }

      const operatorHeaders = {
        "x-tenant-id": TENANT_ID,
        "x-roles": "operator",
      };
      assert.equal(
        (
          await fetch(`${server.url}/v1/tenants/me`, {
            headers: operatorHeaders,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await fetch(`${server.url}/v1/findings`, {
            headers: operatorHeaders,
          })
        ).status,
        200,
      );

      const auditorHeaders = {
        "x-tenant-id": TENANT_ID,
        "x-roles": "auditor",
      };
      assert.equal(
        (
          await fetch(`${server.url}/v1/tenants/me`, {
            headers: auditorHeaders,
          })
        ).status,
        200,
      );
      const audFind = await fetch(`${server.url}/v1/findings`, {
        headers: auditorHeaders,
      });
      assert.equal(audFind.status, 403);
      assert.equal((await audFind.json()).error.code, "FINDINGS_REJECTED");
    } finally {
      await server.close();
    }
  });
});
