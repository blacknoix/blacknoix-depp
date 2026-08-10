import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { AppOptions } from "../../src/app";
import {
  configureExplicitRolesMode,
  resetImplicitOperatorCompatWarnState,
} from "../../src/auth/roles";
import type { ThreatEventService } from "../../src/threat-events/service";
import {
  generateEd25519KeyPairForTests,
  signThreatEventEnvelope,
} from "../../src/threat-events/signature";
import { startTestServer, type TestServer } from "../helpers/test-server";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const AGENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEVICE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const at = "2026-03-01T12:00:00.000Z";

afterEach(() => {
  configureExplicitRolesMode("compat");
  resetImplicitOperatorCompatWarnState();
});

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

const unusedThreatService = (): ThreatEventService => ({
  async submitFromDetection() {
    throw new Error("not used");
  },
  async submitSigned() {
    throw new Error("should not submit");
  },
});

describe("POST /v1/threat-events", () => {
  it("requires agent authentication for all human principal types in both modes", async () => {
    await withServer(
      { threatEventService: unusedThreatService() },
      async (server) => {
        const cases: Array<{
          label: string;
          mode: "compat" | "enforce";
          headers: Record<string, string>;
        }> = [];
        for (const mode of ["compat", "enforce"] as const) {
          cases.push(
            {
              label: `${mode}/empty`,
              mode,
              headers: { "x-tenant-id": TENANT_ID },
            },
            {
              label: `${mode}/operator`,
              mode,
              headers: { "x-tenant-id": TENANT_ID, "x-roles": "operator" },
            },
            {
              label: `${mode}/auditor`,
              mode,
              headers: { "x-tenant-id": TENANT_ID, "x-roles": "auditor" },
            },
            {
              label: `${mode}/unsupported`,
              mode,
              headers: { "x-tenant-id": TENANT_ID, "x-roles": "admin" },
            },
          );
        }

        for (const c of cases) {
          configureExplicitRolesMode(c.mode);
          resetImplicitOperatorCompatWarnState();
          const res = await fetch(`${server.url}/v1/threat-events`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...c.headers,
            },
            body: JSON.stringify({ kind: "THREATEVENT" }),
          });
          const body = await res.json();
          assert.equal(res.status, 401, c.label);
          assert.equal(body.error.code, "AGENT_AUTH_REQUIRED", c.label);
        }
      },
    );
  });

  it("rejects cross-tenant body claims", async () => {
    await withServer(
      { threatEventService: unusedThreatService() },
      async (server) => {
        const res = await fetch(`${server.url}/v1/threat-events`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-tenant-id": TENANT_ID,
            "x-agent-id": AGENT_ID,
          },
          body: JSON.stringify({
            kind: "THREATEVENT",
            tenantId: OTHER_TENANT,
            agentId: AGENT_ID,
            deviceIdentityId: DEVICE_ID,
            detectionRuleId: "agent.heartbeat_burst",
            title: "burst",
            severity: "medium",
            evidence: {},
            windowStart: at,
            windowEnd: at,
            windowBucket: at,
            occurredAt: at,
            signedAt: at,
            signature: Buffer.alloc(64).toString("base64url"),
          }),
        });
        const body = await res.json();
        assert.equal(res.status, 400);
        assert.equal(body.error.code, "THREAT_EVENT_REJECTED");
      },
    );
  });

  it("returns created on successful signed submit", async () => {
    const { privateKey } = generateEd25519KeyPairForTests();
    const unsigned = {
      kind: "THREATEVENT" as const,
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
      deviceIdentityId: DEVICE_ID,
      detectionRuleId: "agent.heartbeat_burst",
      title: "burst",
      severity: "medium" as const,
      evidence: {},
      windowStart: new Date(at),
      windowEnd: new Date(at),
      windowBucket: new Date(at),
      occurredAt: new Date(at),
      signedAt: new Date(at),
    };
    const signature = signThreatEventEnvelope(privateKey, unsigned);

    const threatEventService: ThreatEventService = {
      async submitFromDetection() {
        throw new Error("not used");
      },
      async submitSigned() {
        return {
          ok: true,
          status: "created",
          threatEventId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          findingId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        };
      },
    };

    await withServer({ threatEventService }, async (server) => {
      const res = await fetch(`${server.url}/v1/threat-events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tenant-id": TENANT_ID,
          "x-agent-id": AGENT_ID,
        },
        body: JSON.stringify({
          ...unsigned,
          windowStart: at,
          windowEnd: at,
          windowBucket: at,
          occurredAt: at,
          signedAt: at,
          signature,
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 201);
      assert.equal(body.data.status, "created");
      assert.equal(body.data.findingId, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
    });
  });

  it("maps invalid_signature to THREAT_EVENT_INVALID", async () => {
    const threatEventService: ThreatEventService = {
      async submitFromDetection() {
        throw new Error("not used");
      },
      async submitSigned() {
        return {
          ok: false,
          status: "invalid_signature",
          reason: "signature verification failed",
        };
      },
    };

    await withServer({ threatEventService }, async (server) => {
      const res = await fetch(`${server.url}/v1/threat-events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tenant-id": TENANT_ID,
          "x-agent-id": AGENT_ID,
        },
        body: JSON.stringify({
          kind: "THREATEVENT",
          tenantId: TENANT_ID,
          agentId: AGENT_ID,
          deviceIdentityId: DEVICE_ID,
          detectionRuleId: "agent.heartbeat_burst",
          title: "burst",
          severity: "medium",
          evidence: {},
          windowStart: at,
          windowEnd: at,
          windowBucket: at,
          occurredAt: at,
          signedAt: at,
          signature: Buffer.alloc(64).toString("base64url"),
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 400);
      assert.equal(body.error.code, "THREAT_EVENT_INVALID");
    });
  });

  it("maps missing identity to non-oracular rejection", async () => {
    const threatEventService: ThreatEventService = {
      async submitFromDetection() {
        throw new Error("not used");
      },
      async submitSigned() {
        return {
          ok: false,
          status: "no_identity",
          reason: "device identity not found",
        };
      },
    };

    await withServer({ threatEventService }, async (server) => {
      const res = await fetch(`${server.url}/v1/threat-events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tenant-id": TENANT_ID,
          "x-agent-id": AGENT_ID,
        },
        body: JSON.stringify({
          kind: "THREATEVENT",
          tenantId: TENANT_ID,
          agentId: AGENT_ID,
          deviceIdentityId: DEVICE_ID,
          detectionRuleId: "agent.heartbeat_burst",
          title: "burst",
          severity: "medium",
          evidence: {},
          windowStart: at,
          windowEnd: at,
          windowBucket: at,
          occurredAt: at,
          signedAt: at,
          signature: Buffer.alloc(64).toString("base64url"),
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 400);
      assert.equal(body.error.code, "THREAT_EVENT_REJECTED");
    });
  });
});
