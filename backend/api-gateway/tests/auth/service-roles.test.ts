import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type JwtConfig,
  verifyAccessToken,
} from "../../src/auth/jwt/access-token";
import { createAuthService } from "../../src/auth/service";
import type { SessionsRepository } from "../../src/sessions/repository";
import type { UsersRepository } from "../../src/users/repository";

const JWT: JwtConfig = {
  secret: "test-secret-that-is-long-enough-to-pass",
  issuer: "depp",
  audience: "depp-api",
  accessTtlSeconds: 900,
};

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const SESSION = "33333333-3333-4333-8333-333333333333";

function stubUsers(): UsersRepository {
  return {
    findOrLinkByIdentity: async () => ({ id: USER }),
  };
}

function stubSessions(): SessionsRepository {
  let refreshRaw = "refresh-1";
  return {
    createSession: async () => ({
      sessionId: SESSION,
      refreshToken: refreshRaw,
    }),
    rotateRefreshToken: async () => {
      refreshRaw = "refresh-2";
      return {
        ok: true as const,
        sessionId: SESSION,
        refreshToken: refreshRaw,
      };
    },
    getSessionUserId: async () => USER,
    revokeSession: async () => true,
  };
}

describe("AuthService transitional human roles (ADR-0011)", () => {
  it("completeOidcLogin and refresh mint JWTs with roles: [operator]", async () => {
    const svc = createAuthService({
      users: stubUsers(),
      sessions: stubSessions(),
      jwtConfig: JWT,
    });

    const login = await svc.completeOidcLogin(TENANT, {
      issuer: "https://idp.example.com",
      subject: "auth0|user-123",
      email: "alice@example.com",
      displayName: "Alice",
    });

    const loginClaims = verifyAccessToken(JWT, login.accessToken);
    assert.equal(loginClaims.kind, "human");
    if (loginClaims.kind !== "human") return;
    assert.deepEqual(loginClaims.roles, ["operator"]);

    const refreshed = await svc.refresh(TENANT, login.refreshToken);
    assert.equal(refreshed.ok, true);
    if (!refreshed.ok) return;

    const refreshClaims = verifyAccessToken(JWT, refreshed.tokens.accessToken);
    assert.equal(refreshClaims.kind, "human");
    if (refreshClaims.kind !== "human") return;
    assert.deepEqual(refreshClaims.roles, ["operator"]);
  });
});
