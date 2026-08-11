import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  configureExplicitRolesMode,
  resetImplicitOperatorCompatWarnState,
} from "../src/auth/roles";
import type { TenantLookup } from "../src/tenants/repository";
import { startTestServer, type TestServer } from "./helpers/test-server";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

afterEach(() => {
  configureExplicitRolesMode("compat");
  resetImplicitOperatorCompatWarnState();
});

async function withServer(
  lookupTenant: TenantLookup,
  run: (server: TestServer) => Promise<void>,
): Promise<void> {
  const server = await startTestServer({ lookupTenant });

  try {
    await run(server);
  } finally {
    await server.close();
  }
}

const resolve: TenantLookup = async (id) => ({
  id,
  slug: "acme",
  name: "Acme Inc",
});

describe("GET /v1/tenants/me tenant lookup", () => {
  it("returns the tenant when the lookup resolves it", async () => {
    await withServer(resolve, async (server) => {
      const res = await fetch(`${server.url}/v1/tenants/me`, {
        headers: {
          "x-tenant-id": TENANT_ID,
          "x-roles": "operator",
        },
      });
      const body = await res.json();

      assert.equal(res.status, 200);
      assert.deepEqual(body.data, { tenantId: TENANT_ID, scope: "tenant" });
      assert.equal(JSON.stringify(body).includes("Acme"), false);
      assert.equal(JSON.stringify(body).includes("slug"), false);
    });
  });

  it("allows auditors; denies agents; enforce denies empty/unsupported", async () => {
    await withServer(resolve, async (server) => {
      configureExplicitRolesMode("compat");
      const compatEmpty = await fetch(`${server.url}/v1/tenants/me`, {
        headers: { "x-tenant-id": TENANT_ID },
      });
      assert.equal(compatEmpty.status, 200);

      configureExplicitRolesMode("enforce");
      const auditor = await fetch(`${server.url}/v1/tenants/me`, {
        headers: { "x-tenant-id": TENANT_ID, "x-roles": "auditor" },
      });
      assert.equal(auditor.status, 200);
      assert.deepEqual((await auditor.json()).data, {
        tenantId: TENANT_ID,
        scope: "tenant",
      });

      const operator = await fetch(`${server.url}/v1/tenants/me`, {
        headers: { "x-tenant-id": TENANT_ID, "x-roles": "operator" },
      });
      assert.equal(operator.status, 200);

      for (const [label, headers] of [
        ["missing", { "x-tenant-id": TENANT_ID }],
        ["unsupported", { "x-tenant-id": TENANT_ID, "x-roles": "admin" }],
        ["agent", { "x-tenant-id": TENANT_ID, "x-agent-id": AGENT_ID }],
      ] as const) {
        const res = await fetch(`${server.url}/v1/tenants/me`, { headers });
        assert.equal(res.status, 403, label);
        assert.equal(
          (await res.json()).error.code,
          "TENANT_SELF_REJECTED",
          label,
        );
      }
    });
  });

  it("ignores client query tenantId and echoes only the principal tenant", async () => {
    const otherTenant = "22222222-2222-4222-8222-222222222222";
    let lookedUp: string | undefined;
    const lookup: TenantLookup = async (id) => {
      lookedUp = id;
      return { id, slug: "acme", name: "Acme Inc" };
    };

    await withServer(lookup, async (server) => {
      const res = await fetch(
        `${server.url}/v1/tenants/me?tenantId=${otherTenant}`,
        {
          headers: {
            "x-tenant-id": TENANT_ID,
            "x-roles": "operator",
          },
        },
      );
      const body = await res.json();

      assert.equal(res.status, 200);
      assert.equal(lookedUp, TENANT_ID);
      assert.deepEqual(body.data, { tenantId: TENANT_ID, scope: "tenant" });
      assert.equal(JSON.stringify(body).includes(otherTenant), false);
    });
  });

  it("fails closed with 400 when the tenant does not exist", async () => {
    const lookup: TenantLookup = async () => undefined;

    await withServer(lookup, async (server) => {
      const res = await fetch(`${server.url}/v1/tenants/me`, {
        headers: {
          "x-tenant-id": TENANT_ID,
          "x-roles": "operator",
        },
      });
      const body = await res.json();

      assert.equal(res.status, 400);
      assert.equal(body.error.code, "TENANT_REQUIRED");
    });
  });

  it("is not an oracle: an unknown tenant is indistinguishable from a missing one", async () => {
    const lookup: TenantLookup = async () => undefined;

    await withServer(lookup, async (server) => {
      const missingHeader = await fetch(`${server.url}/v1/tenants/me`);
      const unknownTenant = await fetch(`${server.url}/v1/tenants/me`, {
        headers: {
          "x-tenant-id": TENANT_ID,
          "x-roles": "operator",
        },
      });

      const missingBody = await missingHeader.json();
      const unknownBody = await unknownTenant.json();

      assert.equal(missingHeader.status, 400);
      assert.equal(unknownTenant.status, 400);
      assert.deepEqual(missingBody.error, unknownBody.error);
    });
  });
});
