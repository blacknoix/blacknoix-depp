import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AppOptions } from "../../src/app";
import type { AgentsService } from "../../src/agents/service";
import type { DeviceIdentityService } from "../../src/threat-events/device-identity";
import { generateEd25519KeyPairForTests } from "../../src/threat-events/signature";
import { startTestServer, type TestServer } from "../helpers/test-server";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_AGENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DEVICE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

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

function stubAgents(): AgentsService {
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
  };
}

describe("POST /v1/agents/:agentId/device-identity", () => {
  it("binds a valid public key for the authenticated agent", async () => {
    const { publicKeyEd25519 } = generateEd25519KeyPairForTests();
    const deviceIdentities: DeviceIdentityService = {
      async bindForAgent(_tenantId, agentId, key) {
        return {
          ok: true,
          status: "created",
          identity: {
            id: DEVICE_ID,
            tenantId: TENANT_ID,
            agentId,
            publicKeyEd25519: key,
            deviceCertPem: null,
            status: "active",
            createdAt: new Date("2026-03-01T12:00:00.000Z"),
            revokedAt: null,
          },
        };
      },
      async revokeForAgent() {
        return { ok: false, reason: "not_found" };
      },
    };

    await withServer(
      { agentsService: stubAgents(), deviceIdentities },
      async (server) => {
        const res = await fetch(
          `${server.url}/v1/agents/${AGENT_ID}/device-identity`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-tenant-id": TENANT_ID,
              "x-agent-id": AGENT_ID,
            },
            body: JSON.stringify({ publicKeyEd25519 }),
          },
        );
        const body = await res.json();
        assert.equal(res.status, 201);
        assert.equal(body.data.deviceIdentityId, DEVICE_ID);
        assert.equal(body.data.status, "active");
      },
    );
  });

  it("rejects binding another agent's path id", async () => {
    const { publicKeyEd25519 } = generateEd25519KeyPairForTests();
    await withServer(
      {
        agentsService: stubAgents(),
        deviceIdentities: {
          async bindForAgent() {
            throw new Error("should not bind");
          },
          async revokeForAgent() {
            return { ok: false, reason: "not_found" };
          },
        },
      },
      async (server) => {
        const res = await fetch(
          `${server.url}/v1/agents/${OTHER_AGENT}/device-identity`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-tenant-id": TENANT_ID,
              "x-agent-id": AGENT_ID,
            },
            body: JSON.stringify({ publicKeyEd25519 }),
          },
        );
        const body = await res.json();
        assert.equal(res.status, 403);
        assert.equal(body.error.code, "DEVICE_IDENTITY_REJECTED");
      },
    );
  });

  it("rejects malformed public keys", async () => {
    await withServer(
      {
        agentsService: stubAgents(),
        deviceIdentities: {
          async bindForAgent() {
            return {
              ok: false,
              reason: "malformed_key",
              message: "publicKeyEd25519 must be base64url of 32 raw bytes",
            };
          },
          async revokeForAgent() {
            return { ok: false, reason: "not_found" };
          },
        },
      },
      async (server) => {
        const res = await fetch(
          `${server.url}/v1/agents/${AGENT_ID}/device-identity`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-tenant-id": TENANT_ID,
              "x-agent-id": AGENT_ID,
            },
            body: JSON.stringify({ publicKeyEd25519: "bad" }),
          },
        );
        const body = await res.json();
        assert.equal(res.status, 400);
        assert.equal(body.error.code, "DEVICE_IDENTITY_INVALID");
      },
    );
  });

  it("rejects revoked identities", async () => {
    const { publicKeyEd25519 } = generateEd25519KeyPairForTests();
    await withServer(
      {
        agentsService: stubAgents(),
        deviceIdentities: {
          async bindForAgent() {
            return {
              ok: false,
              reason: "revoked",
              message: "device identity is revoked",
            };
          },
          async revokeForAgent() {
            return { ok: false, reason: "not_found" };
          },
        },
      },
      async (server) => {
        const res = await fetch(
          `${server.url}/v1/agents/${AGENT_ID}/device-identity`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-tenant-id": TENANT_ID,
              "x-agent-id": AGENT_ID,
            },
            body: JSON.stringify({ publicKeyEd25519 }),
          },
        );
        const body = await res.json();
        assert.equal(res.status, 400);
        assert.equal(body.error.code, "DEVICE_IDENTITY_REVOKED");
      },
    );
  });

  it("requires agent authentication", async () => {
    await withServer(
      {
        agentsService: stubAgents(),
        deviceIdentities: {
          async bindForAgent() {
            throw new Error("should not bind");
          },
          async revokeForAgent() {
            return { ok: false, reason: "not_found" };
          },
        },
      },
      async (server) => {
        const res = await fetch(
          `${server.url}/v1/agents/${AGENT_ID}/device-identity`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-tenant-id": TENANT_ID,
            },
            body: JSON.stringify({ publicKeyEd25519: "x" }),
          },
        );
        const body = await res.json();
        assert.equal(res.status, 401);
        assert.equal(body.error.code, "AGENT_AUTH_REQUIRED");
      },
    );
  });
});

describe("POST /v1/agents/:agentId/device-identity/revoke", () => {
  it("allows an operator to revoke", async () => {
    await withServer(
      {
        agentsService: stubAgents(),
        deviceIdentities: {
          async bindForAgent() {
            throw new Error("not used");
          },
          async revokeForAgent() {
            return {
              ok: true,
              identity: {
                id: DEVICE_ID,
                tenantId: TENANT_ID,
                agentId: AGENT_ID,
                publicKeyEd25519: "pk",
                deviceCertPem: null,
                status: "revoked",
                createdAt: new Date(),
                revokedAt: new Date(),
              },
            };
          },
        },
      },
      async (server) => {
        const res = await fetch(
          `${server.url}/v1/agents/${AGENT_ID}/device-identity/revoke`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-tenant-id": TENANT_ID,
            },
            body: "{}",
          },
        );
        const body = await res.json();
        assert.equal(res.status, 200);
        assert.equal(body.data.revoked, true);
      },
    );
  });
});
