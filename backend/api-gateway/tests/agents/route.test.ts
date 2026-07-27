import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AppOptions } from "../../src/app";
import type { AgentsService } from "../../src/agents/service";
import { startTestServer, type TestServer } from "../helpers/test-server";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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

function stubAgents(
  overrides: Partial<AgentsService> = {},
): AgentsService {
  return {
    register: async (_tenantId, name) => ({
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
    ...overrides,
  };
}

describe("POST /v1/agents", () => {
  it("requires a tenant principal", async () => {
    await withServer({ agentsService: stubAgents() }, async (server) => {
      const res = await fetch(`${server.url}/v1/agents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "edge-1" }),
      });
      const body = await res.json();
      assert.equal(res.status, 400);
      assert.equal(body.error.code, "TENANT_REQUIRED");
    });
  });

  it("fails closed with 503 when agents are not wired", async () => {
    await withServer({}, async (server) => {
      const res = await fetch(`${server.url}/v1/agents`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tenant-id": TENANT_ID,
        },
        body: JSON.stringify({ name: "edge-1" }),
      });
      const body = await res.json();
      assert.equal(res.status, 503);
      assert.equal(body.error.code, "AGENTS_UNAVAILABLE");
    });
  });

  it("rejects an empty name", async () => {
    await withServer({ agentsService: stubAgents() }, async (server) => {
      const res = await fetch(`${server.url}/v1/agents`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tenant-id": TENANT_ID,
        },
        body: JSON.stringify({ name: "  " }),
      });
      const body = await res.json();
      assert.equal(res.status, 400);
      assert.equal(body.error.code, "AGENT_INVALID");
    });
  });

  it("returns agentId and one-time credential on success", async () => {
    let seenTenant: string | undefined;
    await withServer(
      {
        agentsService: stubAgents({
          register: async (tenantId, name) => {
            seenTenant = tenantId;
            return { agentId: AGENT_ID, name, credential: "secret-once" };
          },
        }),
      },
      async (server) => {
        const res = await fetch(`${server.url}/v1/agents`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-tenant-id": TENANT_ID,
          },
          body: JSON.stringify({ name: "edge-1" }),
        });
        const body = await res.json();
        assert.equal(res.status, 201);
        assert.equal(body.ok, true);
        assert.deepEqual(body.data, {
          agentId: AGENT_ID,
          name: "edge-1",
          credential: "secret-once",
        });
        assert.equal(seenTenant, TENANT_ID);
      },
    );
  });
});

describe("POST /v1/auth/agent/token", () => {
  it("returns tokens on success", async () => {
    await withServer({ agentsService: stubAgents() }, async (server) => {
      const res = await fetch(`${server.url}/v1/auth/agent/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: TENANT_ID,
          agentId: AGENT_ID,
          credential: "secret",
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.data.tokenType, "Bearer");
      assert.equal(body.data.accessToken, "agent.jwt");
    });
  });

  it("is non-oracular on invalid or revoked credentials", async () => {
    for (const reason of ["invalid", "revoked"] as const) {
      await withServer(
        {
          agentsService: stubAgents({
            exchangeForAccessToken: async () => ({ ok: false, reason }),
          }),
        },
        async (server) => {
          const res = await fetch(`${server.url}/v1/auth/agent/token`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              tenantId: TENANT_ID,
              agentId: AGENT_ID,
              credential: "x",
            }),
          });
          const body = await res.json();
          assert.equal(res.status, 401);
          assert.equal(body.error.code, "AGENT_TOKEN_REJECTED");
        },
      );
    }
  });
});

describe("GET /v1/agents", () => {
  it("rejects agent principals", async () => {
    await withServer({ agentsService: stubAgents() }, async (server) => {
      const res = await fetch(`${server.url}/v1/agents`, {
        headers: {
          "x-tenant-id": TENANT_ID,
          "x-agent-id": AGENT_ID,
        },
      });
      assert.equal(res.status, 403);
      const body = await res.json();
      assert.equal(body.error.code, "AGENTS_REJECTED");
    });
  });

  it("rejects query parameters and returns inventory for operators", async () => {
    await withServer(
      {
        agentsService: stubAgents({
          listInventory: async (tenantId) => {
            assert.equal(tenantId, TENANT_ID);
            return [
              {
                id: AGENT_ID,
                name: "edge-1",
                createdAt: new Date("2026-03-01T12:00:00.000Z"),
                lastHeartbeatAt: new Date("2026-03-01T11:58:00.000Z"),
                openFindingsCount: 2,
                heartbeatFreshness: "recent",
              },
            ];
          },
        }),
      },
      async (server) => {
        const bad = await fetch(`${server.url}/v1/agents?limit=10`, {
          headers: { "x-tenant-id": TENANT_ID },
        });
        assert.equal(bad.status, 400);

        const res = await fetch(`${server.url}/v1/agents`, {
          headers: { "x-tenant-id": TENANT_ID },
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.ok, true);
        assert.equal(body.data.agents.length, 1);
        assert.equal(body.data.agents[0].id, AGENT_ID);
        assert.equal(body.data.agents[0].heartbeatFreshness, "recent");
        assert.equal(body.data.agents[0].openFindingsCount, 2);
      },
    );
  });
});
