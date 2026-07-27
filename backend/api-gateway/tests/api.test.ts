import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestServer, type TestServer } from "./helpers/test-server";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let server: TestServer;

before(async () => {
  server = await startTestServer();
});

after(async () => {
  await server.close();
});

describe("infrastructure routes", () => {
  it("GET / returns the service identity shape", async () => {
    const res = await fetch(`${server.url}/`);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(body, {
      service: "api-gateway",
      status: "ok",
      message: "DEPP API Gateway is running",
    });
  });

  it("GET /health returns ok with an ISO timestamp", async () => {
    const res = await fetch(`${server.url}/health`);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.service, "api-gateway");
    assert.equal(
      new Date(body.timestamp).toISOString(),
      body.timestamp,
      "timestamp should be a valid ISO-8601 string",
    );
  });
});

describe("GET /v1/tenants/me", () => {
  it("returns 400 with the error envelope when x-tenant-id is missing", async () => {
    const res = await fetch(`${server.url}/v1/tenants/me`);
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.ok, false);
    assert.deepEqual(body.error, {
      code: "TENANT_REQUIRED",
      message: "x-tenant-id header is required",
    });
    assert.match(body.requestId, UUID_V4);
  });

  it("returns 200 with the tenant payload when x-tenant-id is present", async () => {
    const res = await fetch(`${server.url}/v1/tenants/me`, {
      headers: { "x-tenant-id": "tenant-dev-001" },
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(body.data, {
      tenantId: "tenant-dev-001",
      scope: "tenant",
    });
    assert.match(body.requestId, UUID_V4);
  });
});

describe("request correlation", () => {
  it("preserves a supplied x-request-id in both the header and the body", async () => {
    const requestId = "my-trace-abc123";

    const res = await fetch(`${server.url}/v1/tenants/me`, {
      headers: {
        "x-tenant-id": "tenant-dev-001",
        "x-request-id": requestId,
      },
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-request-id"), requestId);
    assert.equal(body.requestId, requestId);
  });
});

describe("unmatched routes", () => {
  it("returns 404 with the error envelope", async () => {
    const res = await fetch(`${server.url}/does-not-exist`);
    const body = await res.json();

    assert.equal(res.status, 404);
    assert.equal(body.ok, false);
    assert.deepEqual(body.error, {
      code: "NOT_FOUND",
      message: "Route not found",
    });
    assert.match(body.requestId, UUID_V4);
  });
});
