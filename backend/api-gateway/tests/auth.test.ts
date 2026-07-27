import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { createAuthStrategy, resolveAuthMode } from "../src/auth/auth-mode";
import type { JwtConfig } from "../src/auth/jwt/access-token";
import { startTestServer, type TestServer } from "./helpers/test-server";

let server: TestServer;

before(async () => {
  server = await startTestServer();
});

after(async () => {
  await server.close();
});

describe("principal population", () => {
  it("populates a principal from a valid credential", async () => {
    const res = await fetch(`${server.url}/v1/tenants/me`, {
      headers: { "x-tenant-id": "tenant-dev-001" },
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.tenantId, "tenant-dev-001");
  });

  it("leaves the principal unset when no credential is supplied", async () => {
    const res = await fetch(`${server.url}/v1/tenants/me`);
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.error.code, "TENANT_REQUIRED");
  });

  it("sources tenant identity from the strategy, not from route header parsing", async () => {
    // A strategy that ignores headers entirely proves the route reads the
    // principal rather than re-parsing x-tenant-id itself.
    const fixed = await startTestServer({
      authStrategy: {
        name: "test-fixed",
        authenticate: () => ({ tenantId: "tenant-from-strategy" }),
      },
    });

    try {
      const res = await fetch(`${fixed.url}/v1/tenants/me`, {
        headers: { "x-tenant-id": "tenant-from-header" },
      });
      const body = await res.json();

      assert.equal(res.status, 200);
      assert.equal(body.data.tenantId, "tenant-from-strategy");
    } finally {
      await fixed.close();
    }
  });
});

describe("public routes require no principal", () => {
  it("GET / stays public", async () => {
    const res = await fetch(`${server.url}/`);

    assert.equal(res.status, 200);
    assert.equal((await res.json()).service, "api-gateway");
  });

  it("GET /health stays public", async () => {
    const res = await fetch(`${server.url}/health`);

    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
  });
});

describe("AUTH_MODE resolution", () => {
  it("defaults to dev-header outside production", () => {
    assert.equal(resolveAuthMode(undefined, "development"), "dev-header");
    assert.equal(resolveAuthMode("dev-header", "test"), "dev-header");
  });

  it("rejects an unknown mode rather than falling back to a default", () => {
    // "saml" is not implemented; "jwt" and "dev-header" are.
    assert.throws(
      () => resolveAuthMode("saml", "development"),
      /Invalid AUTH_MODE "saml"\. Supported modes: dev-header, jwt\./,
    );

    assert.throws(() => resolveAuthMode("", "development"), /Invalid AUTH_MODE/);
    assert.throws(() => resolveAuthMode("DEV-HEADER", "development"), /Invalid AUTH_MODE/);
  });

  it("allows the verified jwt mode in production", () => {
    assert.equal(resolveAuthMode("jwt", "production"), "jwt");
  });

  it("refuses to run an unverified strategy in production", () => {
    assert.throws(
      () => resolveAuthMode("dev-header", "production"),
      /cannot be used when NODE_ENV=production/,
    );

    // Also via the default: omitting AUTH_MODE must not sneak dev-header in.
    assert.throws(
      () => resolveAuthMode(undefined, "production"),
      /cannot be used when NODE_ENV=production/,
    );
  });

  it("builds a strategy for each mode", () => {
    assert.equal(createAuthStrategy("dev-header").name, "dev-header");

    const jwtConfig: JwtConfig = {
      secret: "s".repeat(32),
      issuer: "depp",
      audience: "depp-api",
      accessTtlSeconds: 900,
    };
    assert.equal(createAuthStrategy("jwt", { jwtConfig }).name, "jwt");
  });

  it("refuses to build the jwt strategy without configuration (fail closed)", () => {
    assert.throws(() => createAuthStrategy("jwt"), /requires JWT configuration/);
  });
});
