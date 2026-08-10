import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  configureExplicitRolesMode,
  resetImplicitOperatorCompatWarnState,
} from "../../src/auth/roles";
import { startTestServer } from "../helpers/test-server";
import type { AuditRepository } from "../../src/audit/repository";
import type { AgentsService } from "../../src/agents/service";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

afterEach(() => {
  configureExplicitRolesMode("compat");
  resetImplicitOperatorCompatWarnState();
});

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
    rotateCredential: async () => ({
      agentId: AGENT_ID,
      credentialId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      credential: "rotated-once",
      expiresAt: new Date("2026-11-05T00:00:00.000Z"),
      priorCredentialId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      priorGraceEndsAt: new Date("2026-08-08T00:00:00.000Z"),
    }),
    revokeCredential: async () => true,
    listInventory: async () => [],
  };
}

describe("AUTH_EXPLICIT_ROLES_MODE=enforce route denials", () => {
  it("denies missing/empty/unsupported human roles consistently on audit + agents", async () => {
    configureExplicitRolesMode("enforce");

    const server = await startTestServer({
      audit: stubAudit(),
      agentsService: stubAgents(),
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
        const audit = await fetch(`${server.url}/v1/audit/logs`, { headers });
        assert.equal(audit.status, 403, label);
        assert.equal((await audit.json()).error.code, "AUDIT_REJECTED", label);

        const enroll = await fetch(`${server.url}/v1/agents`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ name: "should-fail" }),
        });
        assert.equal(enroll.status, 403, label);
        assert.equal((await enroll.json()).error.code, "AGENTS_REJECTED", label);

        const rotate = await fetch(
          `${server.url}/v1/agents/${AGENT_ID}/credentials/rotate`,
          { method: "POST", headers },
        );
        assert.equal(rotate.status, 403, label);
        assert.equal((await rotate.json()).error.code, "AGENTS_REJECTED", label);

        const revoke = await fetch(
          `${server.url}/v1/agents/${AGENT_ID}/credentials/revoke`,
          { method: "POST", headers },
        );
        assert.equal(revoke.status, 403, label);

        const inventory = await fetch(`${server.url}/v1/agents`, { headers });
        assert.equal(inventory.status, 403, label);
      }

      const operatorHeaders = {
        "x-tenant-id": TENANT_ID,
        "x-roles": "operator",
        "content-type": "application/json",
      };
      const opAudit = await fetch(`${server.url}/v1/audit/logs`, {
        headers: operatorHeaders,
      });
      assert.equal(opAudit.status, 200);

      const opEnroll = await fetch(`${server.url}/v1/agents`, {
        method: "POST",
        headers: operatorHeaders,
        body: JSON.stringify({ name: "ok" }),
      });
      assert.equal(opEnroll.status, 201);

      const auditorHeaders = {
        "x-tenant-id": TENANT_ID,
        "x-roles": "auditor",
      };
      const audAudit = await fetch(`${server.url}/v1/audit/logs`, {
        headers: auditorHeaders,
      });
      assert.equal(audAudit.status, 200);

      const audEnroll = await fetch(`${server.url}/v1/agents`, {
        method: "POST",
        headers: { ...auditorHeaders, "content-type": "application/json" },
        body: JSON.stringify({ name: "nope" }),
      });
      assert.equal(audEnroll.status, 403);
      assert.equal((await audEnroll.json()).error.code, "AGENTS_REJECTED");
    } finally {
      await server.close();
    }
  });
});
