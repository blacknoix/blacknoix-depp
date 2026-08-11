import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  issueAccessToken,
  issueAgentAccessToken,
  type JwtConfig,
} from "../../src/auth/jwt/access-token";
import {
  applyExplicitRolesModeFromEnv,
  configureExplicitRolesMode,
  getExplicitRolesMode,
  resetImplicitOperatorCompatWarnState,
} from "../../src/auth/roles";
import { createJwtStrategy } from "../../src/auth/strategies/jwt";
import type { CorrelationService } from "../../src/correlation/service";
import type { ThreatEventService } from "../../src/threat-events/service";
import { startTestServer } from "../helpers/test-server";

/**
 * Enforce-mode readiness for routes included on this RBAC foundation branch:
 * findings, tenants/me, threat-events (agent-only). Minted JWTs — not x-roles.
 *
 * Mode is applied via applyExplicitRolesModeFromEnv (same helper env.ts uses at
 * startup), not by treating a naked configureExplicitRolesMode call as proof of
 * deployment wiring.
 */

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const AGENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const JWT_CONFIG: JwtConfig = {
  secret: "enforce-readiness-test-secret-xxxxxxxx",
  issuer: "depp",
  audience: "depp-api",
  accessTtlSeconds: 900,
};

afterEach(() => {
  configureExplicitRolesMode("compat");
  resetImplicitOperatorCompatWarnState();
});

function humanBearer(roles?: readonly string[]): string {
  const token = issueAccessToken(JWT_CONFIG, {
    tenantId: TENANT_ID,
    userId: USER_ID,
    sessionId: SESSION_ID,
    ...(roles !== undefined ? { roles } : {}),
  });
  return `Bearer ${token}`;
}

function agentBearer(): string {
  const token = issueAgentAccessToken(JWT_CONFIG, {
    tenantId: TENANT_ID,
    agentId: AGENT_ID,
  });
  return `Bearer ${token}`;
}

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

function stubThreatEvents(): ThreatEventService {
  return {
    submitFromDetection: async () => {
      throw new Error("not used");
    },
    submitSigned: async () => {
      throw new Error("should not submit");
    },
  };
}

const resolveTenant = async (id: string) => ({
  id,
  slug: "acme",
  name: "Acme Inc",
});

describe("enforce-mode readiness (minted JWT roles)", () => {
  it("applies AUTH_EXPLICIT_ROLES_MODE=enforce via startup helper; operator allowed, missing denied", async () => {
    assert.equal(
      applyExplicitRolesModeFromEnv("enforce"),
      "enforce",
    );
    assert.equal(getExplicitRolesMode(), "enforce");

    const server = await startTestServer({
      authStrategy: createJwtStrategy(JWT_CONFIG),
      lookupTenant: resolveTenant,
      correlationService: stubCorrelation(),
      threatEventService: stubThreatEvents(),
    });

    try {
      const op = { authorization: humanBearer(["operator"]) };
      const aud = { authorization: humanBearer(["auditor"]) };
      const missing = { authorization: humanBearer() };
      const empty = { authorization: humanBearer([]) };
      const unsupported = { authorization: humanBearer(["admin"]) };
      const agent = { authorization: agentBearer() };

      assert.equal(
        (await fetch(`${server.url}/v1/findings`, { headers: op })).status,
        200,
      );
      assert.equal(
        (await fetch(`${server.url}/v1/tenants/me`, { headers: op })).status,
        200,
      );

      assert.equal(
        (await fetch(`${server.url}/v1/tenants/me`, { headers: aud })).status,
        200,
      );
      const audFind = await fetch(`${server.url}/v1/findings`, { headers: aud });
      assert.equal(audFind.status, 403);
      assert.equal((await audFind.json()).error.code, "FINDINGS_REJECTED");

      for (const [label, headers] of [
        ["missing", missing],
        ["empty", empty],
        ["unsupported", unsupported],
      ] as const) {
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

      const agentThreat = await fetch(`${server.url}/v1/threat-events`, {
        method: "POST",
        headers: {
          ...agent,
          "content-type": "application/json",
        },
        body: JSON.stringify({ kind: "THREATEVENT" }),
      });
      // Agent JWT reaches the handler; stub rejects as invalid envelope → not AUTH
      assert.notEqual(agentThreat.status, 401);

      const humanThreat = await fetch(`${server.url}/v1/threat-events`, {
        method: "POST",
        headers: {
          ...op,
          "content-type": "application/json",
        },
        body: JSON.stringify({ kind: "THREATEVENT" }),
      });
      assert.equal(humanThreat.status, 401);
      assert.equal((await humanThreat.json()).error.code, "AGENT_AUTH_REQUIRED");

      const agentMe = await fetch(`${server.url}/v1/tenants/me`, {
        headers: agent,
      });
      assert.equal(agentMe.status, 403);
      assert.equal((await agentMe.json()).error.code, "TENANT_SELF_REJECTED");
    } finally {
      await server.close();
    }
  });
});
