import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Request } from "express";

import { issueAccessToken, issueAgentAccessToken, type JwtConfig } from "../src/auth/jwt/access-token";
import { InvalidCredentialError } from "../src/auth/principal";
import { createJwtStrategy } from "../src/auth/strategies/jwt";

/** Flips one character of the signature, leaving header and payload intact. */
function tamperSignature(token: string): string {
  const [header, payload, signature] = token.split(".");
  const flipped = (signature[0] === "A" ? "B" : "A") + signature.slice(1);
  return `${header}.${payload}.${flipped}`;
}

/** Re-headers a token as an unsecured JWT (RFC 7519 §6) with an empty signature. */
function algNone(token: string): string {
  const [, payload] = token.split(".");
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  return `${header}.${payload}.`;
}

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

  it("treats an absent or non-Bearer credential as no credential", () => {
    assert.equal(strategy.authenticate(reqWith({})), undefined);
    assert.equal(strategy.authenticate(reqWith({ authorization: "Basic abc" })), undefined);
  });

  it("treats a blank Bearer credential as presented-and-malformed, not absent", () => {
    // The caller attempted bearer auth and supplied nothing usable. Reporting
    // this as "no credential" sends them a tenant-header error for what is
    // actually an empty token.
    for (const header of ["Bearer", "Bearer ", "Bearer    ", "bearer  "]) {
      assert.throws(
        () => strategy.authenticate(reqWith({ authorization: header })),
        InvalidCredentialError,
        JSON.stringify(header),
      );
    }
  });

  it("does not authenticate on a prefix of a space-containing credential", () => {
    // "Bearer <valid> junk" must fail, not succeed on the first segment.
    const token = issueAccessToken(config, CLAIMS);
    assert.throws(
      () => strategy.authenticate(reqWith({ authorization: `Bearer ${token} junk` })),
      InvalidCredentialError,
    );
  });

  it("rejects an invalid token as an authentication failure, not as anonymous", () => {
    // Returning undefined here would make a forged token indistinguishable from
    // a request with no credentials, which downgrades the response from 401 to
    // whatever the unauthenticated path yields (400 TENANT_REQUIRED).
    const invalid: Record<string, string> = {
      malformed: "not-a-jwt",
      "wrong shape": "not.a.jwt",
      "tampered signature": tamperSignature(issueAccessToken(config, CLAIMS)),
      "alg none": algNone(issueAccessToken(config, CLAIMS)),
      "wrong secret": issueAccessToken({ ...config, secret: "x".repeat(40) }, CLAIMS),
      "wrong issuer": issueAccessToken({ ...config, issuer: "other" }, CLAIMS),
      "wrong audience": issueAccessToken({ ...config, audience: "other" }, CLAIMS),
      expired: issueAccessToken(config, CLAIMS, Math.floor(Date.now() / 1000) - 4000),
    };

    for (const [label, token] of Object.entries(invalid)) {
      assert.throws(
        () => strategy.authenticate(reqWith({ authorization: `Bearer ${token}` })),
        InvalidCredentialError,
        label,
      );
    }
  });

  it("does not leak which verification check rejected the token", () => {
    try {
      strategy.authenticate(reqWith({ authorization: "Bearer not.a.jwt" }));
      assert.fail("expected InvalidCredentialError");
    } catch (err) {
      assert.ok(err instanceof InvalidCredentialError);
      assert.equal(err.message, "invalid credential");
    }
  });
});
