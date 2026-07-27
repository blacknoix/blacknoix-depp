import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CompletedLogin, OidcLoginService } from "../src/auth/oidc/login";
import type { AuthService, IssuedTokens } from "../src/auth/service";
import type { FederatedIdentity } from "../src/users/repository";
import { startTestServer, type TestServer } from "./helpers/test-server";

const TENANT = "11111111-1111-4111-8111-111111111111";

const TOKENS: IssuedTokens = {
  accessToken: "depp.access.jwt",
  refreshToken: "depp-refresh",
  tokenType: "Bearer",
  expiresIn: 900,
};

const IDENTITY: FederatedIdentity = {
  issuer: "https://idp.example.com",
  subject: "sub-1",
};

function trackingAuthService(): AuthService & { calls: Array<[string, FederatedIdentity]> } {
  const calls: Array<[string, FederatedIdentity]> = [];
  return {
    calls,
    async completeOidcLogin(tenantId, identity) {
      calls.push([tenantId, identity]);
      return TOKENS;
    },
    async refresh() {
      return { ok: false, reason: "invalid" };
    },
  };
}

function loginService(
  complete: (params: { state: string; code: string }) => Promise<CompletedLogin>,
): OidcLoginService {
  return {
    async start() {
      return { redirectUrl: "https://idp.example.com/authorize?state=x" };
    },
    complete,
  };
}

async function get(server: TestServer, path: string, redirect: RequestRedirect = "follow") {
  return fetch(`${server.url}${path}`, { redirect });
}

describe("GET /v1/auth/oidc/start", () => {
  it("redirects (302) to the provider authorization URL", async () => {
    const server = await startTestServer({
      authService: trackingAuthService(),
      oidc: { loginService: loginService(async () => ({ tenantId: TENANT, identity: IDENTITY })) },
    });

    try {
      const res = await get(server, "/v1/auth/oidc/start", "manual");
      assert.equal(res.status, 302);
      assert.match(res.headers.get("location") ?? "", /\/authorize/);
    } finally {
      await server.close();
    }
  });

  it("fails closed with 503 when OIDC is not configured", async () => {
    const server = await startTestServer();
    try {
      const res = await get(server, "/v1/auth/oidc/start", "manual");
      assert.equal(res.status, 503);
    } finally {
      await server.close();
    }
  });
});

describe("GET /v1/auth/oidc/callback", () => {
  it("completes login only after binding succeeds", async () => {
    const authService = trackingAuthService();
    const server = await startTestServer({
      authService,
      oidc: { loginService: loginService(async () => ({ tenantId: TENANT, identity: IDENTITY })) },
    });

    try {
      const res = await get(server, "/v1/auth/oidc/callback?code=c&state=s");
      const body = await res.json();

      assert.equal(res.status, 200);
      assert.equal(body.data.accessToken, TOKENS.accessToken);
      assert.deepEqual(authService.calls, [[TENANT, IDENTITY]]);
    } finally {
      await server.close();
    }
  });

  it("does NOT call completeOidcLogin when binding/verification fails", async () => {
    const authService = trackingAuthService();
    const server = await startTestServer({
      authService,
      oidc: {
        loginService: loginService(async () => {
          throw new Error("no live initiation record");
        }),
      },
    });

    try {
      const res = await get(server, "/v1/auth/oidc/callback?code=c&state=bad");
      const body = await res.json();

      assert.equal(res.status, 401);
      assert.equal(body.error.code, "OIDC_CALLBACK_FAILED");
      assert.equal(authService.calls.length, 0, "login must not run on binding failure");
    } finally {
      await server.close();
    }
  });

  it("rejects a missing state or code with the same generic 401", async () => {
    const authService = trackingAuthService();
    const server = await startTestServer({
      authService,
      oidc: {
        loginService: loginService(async () => {
          throw new Error("must not be called");
        }),
      },
    });

    try {
      const noState = await get(server, "/v1/auth/oidc/callback?code=c");
      const noCode = await get(server, "/v1/auth/oidc/callback?state=s");

      assert.equal(noState.status, 401);
      assert.equal(noCode.status, 401);
      assert.equal((await noState.json()).error.code, "OIDC_CALLBACK_FAILED");
      assert.equal(authService.calls.length, 0);
    } finally {
      await server.close();
    }
  });

  it("fails closed with 503 when OIDC is not configured", async () => {
    const server = await startTestServer();
    try {
      const res = await get(server, "/v1/auth/oidc/callback?code=c&state=s");
      assert.equal(res.status, 503);
      assert.equal((await res.json()).error.code, "AUTH_UNAVAILABLE");
    } finally {
      await server.close();
    }
  });
});
