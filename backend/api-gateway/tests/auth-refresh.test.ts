import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthService, RefreshOutcome } from "../src/auth/service";
import { startTestServer, type TestServer } from "./helpers/test-server";

const TENANT = "11111111-1111-4111-8111-111111111111";

function stubService(refresh: (tenantId: string, token: string) => Promise<RefreshOutcome>): AuthService {
  return {
    async completeOidcLogin() {
      throw new Error("not used in this test");
    },
    refresh: (tenantId, token) => refresh(tenantId, token),
  };
}

async function post(server: TestServer, body: unknown): Promise<Response> {
  return fetch(`${server.url}/v1/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /v1/auth/refresh", () => {
  it("returns new tokens on success", async () => {
    const service = stubService(async () => ({
      ok: true,
      tokens: {
        accessToken: "new.access.token",
        refreshToken: "new-refresh",
        tokenType: "Bearer",
        expiresIn: 900,
      },
    }));
    const server = await startTestServer({ authService: service });

    try {
      const res = await post(server, { tenantId: TENANT, refreshToken: "old-refresh" });
      const body = await res.json();

      assert.equal(res.status, 200);
      assert.equal(body.data.accessToken, "new.access.token");
      assert.equal(body.data.refreshToken, "new-refresh");
      assert.equal(body.data.tokenType, "Bearer");
    } finally {
      await server.close();
    }
  });

  it("is non-oracular: replayed and revoked both return an identical 401", async () => {
    async function statusAndBody(reason: "replayed" | "session_revoked") {
      const server = await startTestServer({
        authService: stubService(async () => ({ ok: false, reason })),
      });
      try {
        const res = await post(server, { tenantId: TENANT, refreshToken: "x" });
        return { status: res.status, body: await res.json() };
      } finally {
        await server.close();
      }
    }

    const replayed = await statusAndBody("replayed");
    const revoked = await statusAndBody("session_revoked");

    assert.equal(replayed.status, 401);
    assert.equal(revoked.status, 401);
    assert.equal(replayed.body.error.code, "REFRESH_REJECTED");
    assert.deepEqual(replayed.body.error, revoked.body.error);
  });

  it("rejects malformed input with the same 401", async () => {
    const server = await startTestServer({
      authService: stubService(async () => {
        throw new Error("service must not be called on malformed input");
      }),
    });

    try {
      const missingToken = await post(server, { tenantId: TENANT });
      const badTenant = await post(server, { tenantId: "not-a-uuid", refreshToken: "x" });

      assert.equal(missingToken.status, 401);
      assert.equal(badTenant.status, 401);
      assert.equal((await missingToken.json()).error.code, "REFRESH_REJECTED");
    } finally {
      await server.close();
    }
  });

  it("fails closed with 503 when no auth service is configured", async () => {
    // startTestServer injects no authService by default.
    const server = await startTestServer();

    try {
      const res = await post(server, { tenantId: TENANT, refreshToken: "x" });
      const body = await res.json();

      assert.equal(res.status, 503);
      assert.equal(body.error.code, "AUTH_UNAVAILABLE");
    } finally {
      await server.close();
    }
  });
});
