import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { AgentsService } from "../../src/agents/service";
import type { AuditRepository } from "../../src/audit/repository";
import {
  issueAccessToken,
  issueAgentAccessToken,
  type JwtConfig,
} from "../../src/auth/jwt/access-token";
import {
  configureExplicitRolesMode,
  resetImplicitOperatorCompatWarnState,
} from "../../src/auth/roles";
import { createJwtStrategy } from "../../src/auth/strategies/jwt";
import type { CorrelationService } from "../../src/correlation/service";
import type { TelemetryService } from "../../src/telemetry/service";
import type { ThreatEventService } from "../../src/threat-events/service";
import { startTestServer } from "../helpers/test-server";

/**
 * Enforce-mode readiness: minted human JWTs (not x-roles) under
 * AUTH_EXPLICIT_ROLES_MODE=enforce. Representative route families only.
 * See docs/runbooks/explicit-roles-enforce-rollout.md.
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

function stubAudit(): AuditRepository {
  return {
    append: async () => ({ id: "audit-1" }),
    list: async () => ({ logs: [], nextCursor: null }),
  };
}

function stubAgents(): AgentsService {
  return {
    register: async (_t, name) => ({
      agentId: AGENT_ID,
      name,
      credential: "plain-once",
      expiresAt: new Date("2026-11-05T00:00:00.000Z"),
      credentialId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    }),
    exchangeForAccessToken: async () => ({
      ok: true,
      credentialId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      tokens: {
        accessToken: "agent.jwt",
        tokenType: "Bearer",
        expiresIn: 900,
      },
    }),
    rotateCredential: async () => null,
    revokeCredential: async () => true,
    listInventory: async () => [],
  };
}

function stubTelemetry(): TelemetryService {
  return {
    ingest: async () => ({
      ok: true,
      event: {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        ingestedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    }),
    ingestBatch: async () => ({ ok: true, events: [] }),
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
  };
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

describe("enforce-mode readiness (minted JWT roles)", () => {
  it("operator JWT succeeds on representative operator families; auditor and denials match contract", async () => {
    configureExplicitRolesMode("enforce");

    const server = await startTestServer({
      authStrategy: createJwtStrategy(JWT_CONFIG),
      audit: stubAudit(),
      agentsService: stubAgents(),
      telemetryService: stubTelemetry(),
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

      // Operator succeeds
      assert.equal(
        (await fetch(`${server.url}/v1/audit/logs`, { headers: op })).status,
        200,
      );
      assert.equal(
        (await fetch(`${server.url}/v1/agents`, { headers: op })).status,
        200,
      );
      assert.equal(
        (
          await fetch(`${server.url}/v1/telemetry/events?agentId=${AGENT_ID}`, {
            headers: op,
          })
        ).status,
        200,
      );
      assert.equal(
        (await fetch(`${server.url}/v1/findings`, { headers: op })).status,
        200,
      );
      assert.equal(
        (await fetch(`${server.url}/v1/tenants/me`, { headers: op })).status,
        200,
      );

      // Auditor: audit + tenants/me only
      assert.equal(
        (await fetch(`${server.url}/v1/audit/logs`, { headers: aud })).status,
        200,
      );
      assert.equal(
        (await fetch(`${server.url}/v1/tenants/me`, { headers: aud })).status,
        200,
      );

      const audAgents = await fetch(`${server.url}/v1/agents`, { headers: aud });
      assert.equal(audAgents.status, 403);
      assert.equal((await audAgents.json()).error.code, "AGENTS_REJECTED");

      const audTel = await fetch(
        `${server.url}/v1/telemetry/events?agentId=${AGENT_ID}`,
        { headers: aud },
      );
      assert.equal(audTel.status, 403);
      assert.equal((await audTel.json()).error.code, "TELEMETRY_QUERY_REJECTED");

      const audFind = await fetch(`${server.url}/v1/findings`, { headers: aud });
      assert.equal(audFind.status, 403);
      assert.equal((await audFind.json()).error.code, "FINDINGS_REJECTED");

      const audIngest = await fetch(`${server.url}/v1/telemetry/events`, {
        method: "POST",
        headers: {
          ...aud,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          schemaVersion: 1,
          eventType: "heartbeat",
          occurredAt: new Date().toISOString(),
        }),
      });
      assert.equal(audIngest.status, 401);
      assert.equal((await audIngest.json()).error.code, "AGENT_AUTH_REQUIRED");

      const audThreat = await fetch(`${server.url}/v1/threat-events`, {
        method: "POST",
        headers: {
          ...aud,
          "content-type": "application/json",
        },
        body: JSON.stringify({ kind: "THREATEVENT" }),
      });
      assert.equal(audThreat.status, 401);
      assert.equal((await audThreat.json()).error.code, "AGENT_AUTH_REQUIRED");

      // Missing / empty / unsupported-only → deny protected human routes
      for (const [label, headers] of [
        ["missing", missing],
        ["empty", empty],
        ["unsupported", unsupported],
      ] as const) {
        const audit = await fetch(`${server.url}/v1/audit/logs`, { headers });
        assert.equal(audit.status, 403, label);
        assert.equal((await audit.json()).error.code, "AUDIT_REJECTED", label);

        const agents = await fetch(`${server.url}/v1/agents`, { headers });
        assert.equal(agents.status, 403, label);
        assert.equal((await agents.json()).error.code, "AGENTS_REJECTED", label);

        const me = await fetch(`${server.url}/v1/tenants/me`, { headers });
        assert.equal(me.status, 403, label);
        assert.equal((await me.json()).error.code, "TENANT_SELF_REJECTED", label);

        const tel = await fetch(
          `${server.url}/v1/telemetry/events?agentId=${AGENT_ID}`,
          { headers },
        );
        assert.equal(tel.status, 403, label);
        assert.equal(
          (await tel.json()).error.code,
          "TELEMETRY_QUERY_REJECTED",
          label,
        );

        const findings = await fetch(`${server.url}/v1/findings`, { headers });
        assert.equal(findings.status, 403, label);
        assert.equal(
          (await findings.json()).error.code,
          "FINDINGS_REJECTED",
          label,
        );
      }

      // Agent JWT: ingest ok; human surfaces denied; independent of roles
      const agentIngest = await fetch(`${server.url}/v1/telemetry/events`, {
        method: "POST",
        headers: {
          ...agent,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          schemaVersion: 1,
          eventType: "heartbeat",
          occurredAt: new Date().toISOString(),
        }),
      });
      assert.equal(agentIngest.status, 201);

      const agentAudit = await fetch(`${server.url}/v1/audit/logs`, {
        headers: agent,
      });
      assert.equal(agentAudit.status, 403);
      assert.equal((await agentAudit.json()).error.code, "AUDIT_REJECTED");

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
