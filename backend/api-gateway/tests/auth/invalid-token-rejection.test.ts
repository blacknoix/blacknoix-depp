import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { issueAccessToken, type JwtConfig } from "../../src/auth/jwt/access-token";
import { createJwtStrategy } from "../../src/auth/strategies/jwt";
import { startTestServer } from "../helpers/test-server";

/**
 * A rejected bearer token must fail AUTHENTICATION (401), not be silently
 * downgraded to an anonymous request that then fails tenant resolution (400).
 *
 * These cases mirror the N1-N3 rows of the local JWT/enforce verification
 * matrix, which caught the original defect: the JWT strategy swallowed every
 * AccessTokenError and returned "no principal", so a tampered signature, an
 * `alg: none` token, and a garbage string all produced the same
 * 400 TENANT_REQUIRED as sending no credentials at all.
 */

const JWT_CONFIG: JwtConfig = {
  secret: "invalid-token-test-secret-xxxxxxxxxx",
  issuer: "depp",
  audience: "depp-api",
  accessTtlSeconds: 900,
};

const CLAIMS = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  sessionId: "33333333-3333-4333-8333-333333333333",
};

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** N1: valid header and payload, one signature byte flipped. */
function tamperedSignature(): string {
  const [header, payload, signature] = issueAccessToken(JWT_CONFIG, CLAIMS).split(".");
  return `${header}.${payload}.${(signature[0] === "A" ? "B" : "A") + signature.slice(1)}`;
}

/** N2: unsecured JWT (RFC 7519 §6) — signature stripped, alg downgraded. */
function algNone(): string {
  const [, payload] = issueAccessToken(JWT_CONFIG, CLAIMS).split(".");
  return `${base64url({ alg: "none", typ: "JWT" })}.${payload}.`;
}

describe("invalid bearer tokens are authentication failures", () => {
  it("answers 401 for tampered, alg:none, and malformed tokens", async () => {
    const server = await startTestServer({
      authStrategy: createJwtStrategy(JWT_CONFIG),
    });

    const cases: Record<string, string> = {
      "N1 tampered signature": tamperedSignature(),
      "N2 alg none": algNone(),
      "N3 malformed": "not-a-jwt",
      "expired": issueAccessToken(JWT_CONFIG, CLAIMS, Math.floor(Date.now() / 1000) - 4000),
      "wrong issuer": issueAccessToken({ ...JWT_CONFIG, issuer: "attacker" }, CLAIMS),
      "wrong audience": issueAccessToken({ ...JWT_CONFIG, audience: "attacker" }, CLAIMS),
    };

    try {
      for (const [label, token] of Object.entries(cases)) {
        const res = await fetch(`${server.url}/v1/alerts`, {
          headers: { authorization: `Bearer ${token}` },
        });

        assert.equal(res.status, 401, label);
        assert.equal(res.headers.get("www-authenticate"), 'Bearer error="invalid_token"', label);

        const body = await res.json();
        assert.equal(body.error.code, "INVALID_TOKEN", label);
        // The rejection must not say which check failed, or it becomes an
        // oracle for forging tokens one constraint at a time.
        assert.doesNotMatch(
          JSON.stringify(body),
          /signature|algorithm|issuer|audience|expired|claims/i,
          label,
        );
      }
    } finally {
      await server.close();
    }
  });

  it("rejects an invalid token before tenant or role authorization runs", async () => {
    // A forged token carrying a well-formed tenant must not reach the tenant or
    // RBAC layer at all: 401 here, never 403 (which would imply the caller was
    // authenticated but under-privileged) and never 200.
    const server = await startTestServer({
      authStrategy: createJwtStrategy(JWT_CONFIG),
      alertsService: {
        list: async () => assert.fail("alerts service reached with an invalid token"),
        getById: async () => assert.fail("alerts service reached with an invalid token"),
      },
    });

    try {
      const res = await fetch(`${server.url}/v1/alerts`, {
        headers: {
          authorization: `Bearer ${tamperedSignature()}`,
          // Hostile fallback headers must not rescue the request either.
          "x-tenant-id": CLAIMS.tenantId,
          "x-roles": "operator",
        },
      });

      assert.equal(res.status, 401);
    } finally {
      await server.close();
    }
  });

  it("answers 401 for a blank Bearer credential and 400 for a non-Bearer scheme", async () => {
    // The documented boundary: `Bearer` with nothing after it is a presented
    // malformed credential (401); a scheme this strategy does not consume is
    // not a bearer credential at all, so the route's unauthenticated behavior
    // stands (400).
    const server = await startTestServer({
      authStrategy: createJwtStrategy(JWT_CONFIG),
    });

    try {
      for (const header of ["Bearer", "Bearer ", "Bearer    "]) {
        const res = await fetch(`${server.url}/v1/alerts`, {
          headers: { authorization: header },
        });
        assert.equal(res.status, 401, JSON.stringify(header));
        assert.equal((await res.json()).error.code, "INVALID_TOKEN", JSON.stringify(header));
      }

      const basic = await fetch(`${server.url}/v1/alerts`, {
        headers: { authorization: "Basic abc" },
      });
      assert.equal(basic.status, 400);
      assert.equal((await basic.json()).error.code, "TENANT_REQUIRED");
    } finally {
      await server.close();
    }
  });

  it("still answers 400 TENANT_REQUIRED when no credential is presented", async () => {
    // The 401 path must not swallow the missing-credential case: absent
    // credentials and rejected credentials are different conditions.
    const server = await startTestServer({
      authStrategy: createJwtStrategy(JWT_CONFIG),
    });

    try {
      const res = await fetch(`${server.url}/v1/alerts`);

      assert.equal(res.status, 400);
      assert.equal((await res.json()).error.code, "TENANT_REQUIRED");
      assert.equal(res.headers.get("www-authenticate"), null);
    } finally {
      await server.close();
    }
  });

  it("leaves unauthenticated infrastructure routes reachable", async () => {
    // authenticate() must keep its "never rejects" property: a bad token aimed
    // at /health is still just a health check, not a 401.
    const server = await startTestServer({
      authStrategy: createJwtStrategy(JWT_CONFIG),
    });

    try {
      const res = await fetch(`${server.url}/health`, {
        headers: { authorization: `Bearer ${tamperedSignature()}` },
      });

      assert.equal(res.status, 200);
    } finally {
      await server.close();
    }
  });
});
