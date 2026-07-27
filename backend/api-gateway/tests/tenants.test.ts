import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { TenantLookup } from "../src/tenants/repository";
import { startTestServer, type TestServer } from "./helpers/test-server";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

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

describe("GET /v1/tenants/me tenant lookup", () => {
  it("returns the tenant when the lookup resolves it", async () => {
    const lookup: TenantLookup = async (id) => ({ id, slug: "acme", name: "Acme Inc" });

    await withServer(lookup, async (server) => {
      const res = await fetch(`${server.url}/v1/tenants/me`, {
        headers: { "x-tenant-id": TENANT_ID },
      });
      const body = await res.json();

      assert.equal(res.status, 200);
      assert.deepEqual(body.data, { tenantId: TENANT_ID, scope: "tenant" });
    });
  });

  it("fails closed with 400 when the tenant does not exist", async () => {
    const lookup: TenantLookup = async () => undefined;

    await withServer(lookup, async (server) => {
      const res = await fetch(`${server.url}/v1/tenants/me`, {
        headers: { "x-tenant-id": TENANT_ID },
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
        headers: { "x-tenant-id": TENANT_ID },
      });

      const missingBody = await missingHeader.json();
      const unknownBody = await unknownTenant.json();

      assert.equal(missingHeader.status, 400);
      assert.equal(unknownTenant.status, 400);
      assert.deepEqual(missingBody.error, unknownBody.error);
    });
  });
});
