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
  resetImplicitOperatorCompatWarnState,
} from "../../src/auth/roles";
import { createJwtStrategy } from "../../src/auth/strategies/jwt";
import type { AlertsService } from "../../src/alerts/service";
import { startTestServer } from "../helpers/test-server";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const AGENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ALERT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const JWT_CONFIG: JwtConfig = {
  secret: "alerts-rbac-test-secret-xxxxxxxxxxxx",
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

function stubAlerts(): AlertsService {
  return {
    list: async () => [
      {
        id: ALERT_ID,
        agentId: AGENT_ID,
        ruleId: "rule.auth_failure_burst.v1",
        createdAt: "2026-03-01T12:05:00.000Z",
        evidence: {
          ruleId: "rule.auth_failure_burst.v1",
          windowStart: "2026-03-01T12:00:00.000Z",
          windowEnd: "2026-03-01T12:05:00.000Z",
          windowBucket: "2026-03-01T12:00:00.000Z",
          contributingCount: 5,
          contributingEventIds: [],
        },
      },
    ],
    getById: async (_t, id) =>
      id === ALERT_ID
        ? {
            id: ALERT_ID,
            agentId: AGENT_ID,
            ruleId: "rule.auth_failure_burst.v1",
            createdAt: "2026-03-01T12:05:00.000Z",
            evidence: {
              ruleId: "rule.auth_failure_burst.v1",
              windowStart: "2026-03-01T12:00:00.000Z",
              windowEnd: "2026-03-01T12:05:00.000Z",
              windowBucket: "2026-03-01T12:00:00.000Z",
              contributingCount: 5,
              contributingEventIds: [],
            },
          }
        : undefined,
  };
}

describe("GET /v1/alerts RBAC (enforce, minted JWT)", () => {
  it("allows operator and auditor; denies agent and role-less human", async () => {
    applyExplicitRolesModeFromEnv("enforce");

    const server = await startTestServer({
      authStrategy: createJwtStrategy(JWT_CONFIG),
      alertsService: stubAlerts(),
    });

    try {
      const op = await fetch(`${server.url}/v1/alerts`, {
        headers: { authorization: humanBearer(["operator"]) },
      });
      assert.equal(op.status, 200);
      assert.equal((await op.json()).ok, true);

      const aud = await fetch(`${server.url}/v1/alerts`, {
        headers: { authorization: humanBearer(["auditor"]) },
      });
      assert.equal(aud.status, 200);

      const detail = await fetch(`${server.url}/v1/alerts/${ALERT_ID}`, {
        headers: { authorization: humanBearer(["auditor"]) },
      });
      assert.equal(detail.status, 200);

      const roleless = await fetch(`${server.url}/v1/alerts`, {
        headers: { authorization: humanBearer([]) },
      });
      assert.equal(roleless.status, 403);
      assert.equal((await roleless.json()).error.code, "ALERTS_REJECTED");

      const agent = await fetch(`${server.url}/v1/alerts`, {
        headers: { authorization: agentBearer() },
      });
      assert.equal(agent.status, 403);
      assert.equal((await agent.json()).error.code, "ALERTS_REJECTED");
    } finally {
      await server.close();
    }
  });
});
