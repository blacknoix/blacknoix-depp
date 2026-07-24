import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Request } from "express";

import { issueAccessToken, issueAgentAccessToken, type JwtConfig } from "../src/auth/jwt/access-token";
import { createJwtStrategy } from "../src/auth/strategies/jwt";

const config: JwtConfig = {
  secret: "s".repeat(40),
  issuer: "depp",
  audience: "depp-api",
  accessTtlSeconds: 900,
};

const CLAIMS = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  sessionId: "33333333-3333-4333-8333-333333333333",
};

/** Minimal Request stub exposing only the headers the strategy reads. */
function reqWith(headers: Record<string, string>): Request {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    lower[k.toLowerCase()] = v;
  }
  return { get: (name: string) => lower[name.toLowerCase()] } as unknown as Request;
}

describe("jwt auth strategy", () => {
  const strategy = createJwtStrategy(config);

  it("derives the principal from token claims", () => {
    const token = issueAccessToken(config, CLAIMS);
    const principal = strategy.authenticate(reqWith({ authorization: `Bearer ${token}` }));

    assert.deepEqual(principal, {
      tenantId: CLAIMS.tenantId,
      userId: CLAIMS.userId,
      sessionId: CLAIMS.sessionId,
    });
  });

  it("derives an agent principal from an agent access token", () => {
    const token = issueAgentAccessToken(config, {
      tenantId: CLAIMS.tenantId,
      agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    const principal = strategy.authenticate(
      reqWith({ authorization: `Bearer ${token}` }),
    );

    assert.deepEqual(principal, {
      tenantId: CLAIMS.tenantId,
      agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
  });

  it("takes identity from the token, never from a header", () => {
    const token = issueAccessToken(config, CLAIMS);
    const principal = strategy.authenticate(
      reqWith({
        authorization: `Bearer ${token}`,
        // A hostile tenant header must be ignored entirely.
        "x-tenant-id": "attacker-tenant",
      }),
    );

    assert.equal(principal?.tenantId, CLAIMS.tenantId);
  });

  it("returns no principal without a bearer token", () => {
    assert.equal(strategy.authenticate(reqWith({})), undefined);
    assert.equal(strategy.authenticate(reqWith({ authorization: "Basic abc" })), undefined);
    assert.equal(strategy.authenticate(reqWith({ authorization: "Bearer" })), undefined);
  });

  it("returns no principal for an invalid token (fails closed)", () => {
    assert.equal(
      strategy.authenticate(reqWith({ authorization: "Bearer not.a.jwt" })),
      undefined,
    );

    const wrongSecret = issueAccessToken({ ...config, secret: "x".repeat(40) }, CLAIMS);
    assert.equal(
      strategy.authenticate(reqWith({ authorization: `Bearer ${wrongSecret}` })),
      undefined,
    );
  });
});
