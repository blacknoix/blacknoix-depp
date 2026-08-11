import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { AgentsService } from "../../src/agents/service";
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
import type { TelemetryService } from "../../src/telemetry/service";
import type { DeviceIdentityService } from "../../src/threat-events/device-identity";
import { generateEd25519KeyPairForTests } from "../../src/threat-events/signature";
import { startTestServer } from "../helpers/test-server";

/**
 * Route-level RBAC for agent management + telemetry query/ingest under enforce,
 * using minted JWTs (not x-roles-only proof).
 */

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const AGENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const JWT_CONFIG: JwtConfig = {
  secret: "agent-telemetry-rbac-test-secret-xxxx",
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

function agentBearer(agentId: string = AGENT_ID): string {
  const token = issueAgentAccessToken(JWT_CONFIG, {
    tenantId: TENANT_ID,
    agentId,
  });
  return `Bearer ${token}`;
}

function stubAgents(): AgentsService {
  return {
    register: async (_t, name) => ({
      agentId: AGENT_ID,
      name,
      credential: "plain-once",
    }),
    exchangeForAccessToken: async () => ({
      ok: true,
      tokens: {
        accessToken: "agent.jwt",
        tokenType: "Bearer",
        expiresIn: 900,
      },
    }),
    revokeCredential: async () => true,
    listInventory: async () => [],
  } as AgentsService;
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

function stubDeviceIdentities(): DeviceIdentityService {
  return {
    async bindForAgent(tenantId, agentId, publicKeyEd25519) {
      return {
        ok: true,
        status: "created",
        identity: {
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          tenantId,
          agentId,
          deviceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          publicKeyEd25519,
          status: "active" as const,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          revokedAt: null,
        },
      };
    },
    async revokeForAgent(tenantId, agentId) {
      return {
        ok: true,
        identity: {
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          tenantId,
          agentId,
          deviceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          publicKeyEd25519: "test-key",
          status: "revoked" as const,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          revokedAt: new Date("2026-01-02T00:00:00.000Z"),
        },
      };
    },
  };
}

describe("agent + telemetry route RBAC (enforce, minted JWT)", () => {
  it("operator allowed; auditor and roleless denied; agent contracts preserved", async () => {
    applyExplicitRolesModeFromEnv("enforce");

    const server = await startTestServer({
      authStrategy: createJwtStrategy(JWT_CONFIG),
      agentsService: stubAgents(),
      telemetryService: stubTelemetry(),
      deviceIdentities: stubDeviceIdentities(),
    });

    try {
      const op = { authorization: humanBearer(["operator"]) };
      const aud = { authorization: humanBearer(["auditor"]) };
      const missing = { authorization: humanBearer() };
      const empty = { authorization: humanBearer([]) };
      const unsupported = { authorization: humanBearer(["admin"]) };
      const agent = { authorization: agentBearer() };

      // --- Agent inventory ---
      assert.equal(
        (await fetch(`${server.url}/v1/agents`, { headers: op })).status,
        200,
      );
      for (const [label, headers] of [
        ["auditor", aud],
        ["missing", missing],
        ["empty", empty],
        ["unsupported", unsupported],
      ] as const) {
        const res = await fetch(`${server.url}/v1/agents`, { headers });
        assert.equal(res.status, 403, `inventory/${label}`);
        assert.equal(
          (await res.json()).error.code,
          "AGENTS_REJECTED",
          `inventory/${label}`,
        );
      }
      const agentInv = await fetch(`${server.url}/v1/agents`, { headers: agent });
      assert.equal(agentInv.status, 403);
      assert.equal((await agentInv.json()).error.code, "AGENTS_REJECTED");

      // --- Agent enrollment ---
      const enrollOp = await fetch(`${server.url}/v1/agents`, {
        method: "POST",
        headers: { ...op, "content-type": "application/json" },
        body: JSON.stringify({ name: "ok-agent" }),
      });
      assert.equal(enrollOp.status, 201);

      for (const [label, headers] of [
        ["auditor", aud],
        ["missing", missing],
        ["empty", empty],
        ["unsupported", unsupported],
      ] as const) {
        const res = await fetch(`${server.url}/v1/agents`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ name: "nope" }),
        });
        assert.equal(res.status, 403, `enroll/${label}`);
        assert.equal(
          (await res.json()).error.code,
          "AGENTS_REJECTED",
          `enroll/${label}`,
        );
      }

      // Agent may still enroll (existing contract)
      const enrollAgent = await fetch(`${server.url}/v1/agents`, {
        method: "POST",
        headers: { ...agent, "content-type": "application/json" },
        body: JSON.stringify({ name: "from-agent" }),
      });
      assert.equal(enrollAgent.status, 201);

      // --- Credential revoke (operator) ---
      assert.equal(
        (
          await fetch(`${server.url}/v1/agents/${AGENT_ID}/credentials/revoke`, {
            method: "POST",
            headers: op,
          })
        ).status,
        200,
      );
      for (const [label, headers] of [
        ["auditor", aud],
        ["missing", missing],
        ["agent", agent],
      ] as const) {
        const res = await fetch(
          `${server.url}/v1/agents/${AGENT_ID}/credentials/revoke`,
          { method: "POST", headers },
        );
        assert.equal(res.status, 403, `cred-revoke/${label}`);
        assert.equal(
          (await res.json()).error.code,
          "AGENTS_REJECTED",
          `cred-revoke/${label}`,
        );
      }

      // --- Device identity revoke (operator) ---
      assert.equal(
        (
          await fetch(
            `${server.url}/v1/agents/${AGENT_ID}/device-identity/revoke`,
            { method: "POST", headers: op },
          )
        ).status,
        200,
      );
      const audRevoke = await fetch(
        `${server.url}/v1/agents/${AGENT_ID}/device-identity/revoke`,
        { method: "POST", headers: aud },
      );
      assert.equal(audRevoke.status, 403);
      assert.equal((await audRevoke.json()).error.code, "AGENTS_REJECTED");

      // --- Device identity bind (agent-only) ---
      const { publicKeyEd25519 } = generateEd25519KeyPairForTests();
      const bindAgent = await fetch(
        `${server.url}/v1/agents/${AGENT_ID}/device-identity`,
        {
          method: "POST",
          headers: { ...agent, "content-type": "application/json" },
          body: JSON.stringify({ publicKeyEd25519 }),
        },
      );
      assert.equal(bindAgent.status, 201);

      for (const [label, headers] of [
        ["operator", op],
        ["auditor", aud],
        ["missing", missing],
      ] as const) {
        const res = await fetch(
          `${server.url}/v1/agents/${AGENT_ID}/device-identity`,
          {
            method: "POST",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({ publicKeyEd25519 }),
          },
        );
        assert.equal(res.status, 401, `bind/${label}`);
        assert.equal(
          (await res.json()).error.code,
          "AGENT_AUTH_REQUIRED",
          `bind/${label}`,
        );
      }

      // --- Telemetry GET/query ---
      assert.equal(
        (
          await fetch(`${server.url}/v1/telemetry/events?agentId=${AGENT_ID}`, {
            headers: op,
          })
        ).status,
        200,
      );
      for (const [label, headers] of [
        ["auditor", aud],
        ["missing", missing],
        ["empty", empty],
        ["unsupported", unsupported],
      ] as const) {
        const res = await fetch(
          `${server.url}/v1/telemetry/events?agentId=${AGENT_ID}`,
          { headers },
        );
        assert.equal(res.status, 403, `tel-query/${label}`);
        assert.equal(
          (await res.json()).error.code,
          "TELEMETRY_QUERY_REJECTED",
          `tel-query/${label}`,
        );
      }
      // Agent self-scope without agentId
      assert.equal(
        (
          await fetch(`${server.url}/v1/telemetry/events`, { headers: agent })
        ).status,
        200,
      );
      // Agent must not query another agent id
      const cross = await fetch(
        `${server.url}/v1/telemetry/events?agentId=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`,
        { headers: agent },
      );
      assert.equal(cross.status, 400);

      // --- Telemetry ingest / batch (agent-only) ---
      const heartbeat = {
        schemaVersion: 1,
        eventType: "heartbeat",
        occurredAt: new Date().toISOString(),
      };
      assert.equal(
        (
          await fetch(`${server.url}/v1/telemetry/events`, {
            method: "POST",
            headers: { ...agent, "content-type": "application/json" },
            body: JSON.stringify(heartbeat),
          })
        ).status,
        201,
      );
      for (const [label, headers] of [
        ["operator", op],
        ["auditor", aud],
        ["missing", missing],
      ] as const) {
        const ingest = await fetch(`${server.url}/v1/telemetry/events`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify(heartbeat),
        });
        assert.equal(ingest.status, 401, `ingest/${label}`);
        assert.equal(
          (await ingest.json()).error.code,
          "AGENT_AUTH_REQUIRED",
          `ingest/${label}`,
        );

        const batch = await fetch(`${server.url}/v1/telemetry/events/batch`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ events: [heartbeat] }),
        });
        assert.equal(batch.status, 401, `batch/${label}`);
        assert.equal(
          (await batch.json()).error.code,
          "AGENT_AUTH_REQUIRED",
          `batch/${label}`,
        );
      }
      assert.equal(
        (
          await fetch(`${server.url}/v1/telemetry/events/batch`, {
            method: "POST",
            headers: { ...agent, "content-type": "application/json" },
            body: JSON.stringify({ events: [heartbeat] }),
          })
        ).status,
        201,
      );
    } finally {
      await server.close();
    }
  });
});

describe("agent + telemetry route RBAC (compat)", () => {
  it("role-less human is implicit operator on management/query; auditor stays least-privileged; agent is not human operator", async () => {
    applyExplicitRolesModeFromEnv("compat");

    const server = await startTestServer({
      authStrategy: createJwtStrategy(JWT_CONFIG),
      agentsService: stubAgents(),
      telemetryService: stubTelemetry(),
    });

    try {
      const roleless = { authorization: humanBearer() };
      const aud = { authorization: humanBearer(["auditor"]) };
      const agent = { authorization: agentBearer() };

      assert.equal(
        (await fetch(`${server.url}/v1/agents`, { headers: roleless })).status,
        200,
      );
      assert.equal(
        (
          await fetch(`${server.url}/v1/telemetry/events?agentId=${AGENT_ID}`, {
            headers: roleless,
          })
        ).status,
        200,
      );

      const audInv = await fetch(`${server.url}/v1/agents`, { headers: aud });
      assert.equal(audInv.status, 403);
      assert.equal((await audInv.json()).error.code, "AGENTS_REJECTED");

      const audTel = await fetch(
        `${server.url}/v1/telemetry/events?agentId=${AGENT_ID}`,
        { headers: aud },
      );
      assert.equal(audTel.status, 403);
      assert.equal((await audTel.json()).error.code, "TELEMETRY_QUERY_REJECTED");

      const agentAsHuman = await fetch(`${server.url}/v1/agents`, {
        headers: agent,
      });
      assert.equal(agentAsHuman.status, 403);
      assert.equal((await agentAsHuman.json()).error.code, "AGENTS_REJECTED");
    } finally {
      await server.close();
    }
  });
});

describe("agent + telemetry RBAC regression guards", () => {
  it("fails closed if inventory or telemetry query accept auditor under enforce", async () => {
    applyExplicitRolesModeFromEnv("enforce");
    const server = await startTestServer({
      authStrategy: createJwtStrategy(JWT_CONFIG),
      agentsService: stubAgents(),
      telemetryService: stubTelemetry(),
    });
    try {
      const aud = { authorization: humanBearer(["auditor"]) };
      const inv = await fetch(`${server.url}/v1/agents`, { headers: aud });
      assert.notEqual(inv.status, 200);
      assert.equal((await inv.json()).error.code, "AGENTS_REJECTED");

      const tel = await fetch(
        `${server.url}/v1/telemetry/events?agentId=${AGENT_ID}`,
        { headers: aud },
      );
      assert.notEqual(tel.status, 200);
      assert.equal((await tel.json()).error.code, "TELEMETRY_QUERY_REJECTED");

      // Human JWT is never an agent credential for ingest
      const ingest = await fetch(`${server.url}/v1/telemetry/events`, {
        method: "POST",
        headers: {
          authorization: humanBearer(["operator"]),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          schemaVersion: 1,
          eventType: "heartbeat",
          occurredAt: new Date().toISOString(),
        }),
      });
      assert.equal(ingest.status, 401);
      assert.equal((await ingest.json()).error.code, "AGENT_AUTH_REQUIRED");
    } finally {
      await server.close();
    }
  });
});
