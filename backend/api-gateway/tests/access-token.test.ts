import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import {
  AccessTokenError,
  issueAccessToken,
  type JwtConfig,
  verifyAccessToken,
} from "../src/auth/jwt/access-token";

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

/** Signs an arbitrary payload with the config secret, for crafting edge cases. */
function craft(payload: unknown, header: unknown = { alg: "HS256", typ: "JWT" }): string {
  const h = Buffer.from(JSON.stringify(header)).toString("base64url");
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", config.secret).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${sig}`;
}

describe("access token issue/verify", () => {
  it("round-trips claims", () => {
    const token = issueAccessToken(config, CLAIMS, 1_000);
    const claims = verifyAccessToken(config, token, 1_000);

    assert.deepEqual(claims, CLAIMS);
  });

  it("rejects an expired token", () => {
    const token = issueAccessToken(config, CLAIMS, 1_000);

    assert.throws(
      () => verifyAccessToken(config, token, 1_000 + config.accessTtlSeconds),
      (err: unknown) => err instanceof AccessTokenError && /expired/.test(err.message),
    );
  });

  it("accepts right up to the expiry boundary", () => {
    const token = issueAccessToken(config, CLAIMS, 1_000);
    // exp = 1900; valid at 1899, expired at 1900.
    assert.doesNotThrow(() => verifyAccessToken(config, token, 1_899));
    assert.throws(() => verifyAccessToken(config, token, 1_900), AccessTokenError);
  });

  it("rejects a wrong issuer", () => {
    const token = issueAccessToken({ ...config, issuer: "evil" }, CLAIMS, 1_000);

    assert.throws(
      () => verifyAccessToken(config, token, 1_000),
      /wrong issuer/,
    );
  });

  it("rejects a wrong audience", () => {
    const token = issueAccessToken({ ...config, audience: "someone-else" }, CLAIMS, 1_000);

    assert.throws(
      () => verifyAccessToken(config, token, 1_000),
      /wrong audience/,
    );
  });

  it("rejects a token signed with a different secret", () => {
    const token = issueAccessToken({ ...config, secret: "x".repeat(40) }, CLAIMS, 1_000);

    assert.throws(() => verifyAccessToken(config, token, 1_000), /bad signature/);
  });

  it("rejects a tampered payload", () => {
    const token = issueAccessToken(config, CLAIMS, 1_000);
    const [h, , s] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...CLAIMS, tid: "attacker" }),
    ).toString("base64url");

    assert.throws(() => verifyAccessToken(config, `${h}.${forged}.${s}`, 1_000), /bad signature/);
  });

  it("rejects malformed tokens", () => {
    assert.throws(() => verifyAccessToken(config, "abc", 1_000), /malformed/);
    assert.throws(() => verifyAccessToken(config, "a.b", 1_000), /malformed/);
  });

  it("rejects alg tampering (none / non-HS256)", () => {
    const noneTok = craft(
      { ...CLAIMS, iss: config.issuer, aud: config.audience, iat: 1_000, exp: 2_000, tid: CLAIMS.tenantId, sub: CLAIMS.userId, sid: CLAIMS.sessionId },
      { alg: "none", typ: "JWT" },
    );
    assert.throws(() => verifyAccessToken(config, noneTok, 1_000), /unexpected algorithm/);

    const rsTok = craft(
      { iss: config.issuer, aud: config.audience, iat: 1_000, exp: 2_000, tid: CLAIMS.tenantId, sub: CLAIMS.userId, sid: CLAIMS.sessionId },
      { alg: "RS256", typ: "JWT" },
    );
    assert.throws(() => verifyAccessToken(config, rsTok, 1_000), /unexpected algorithm/);
  });

  it("rejects a signature-valid token missing required claims", () => {
    // Correctly signed with the real secret, but no tid — must still be rejected.
    const token = craft({
      iss: config.issuer,
      aud: config.audience,
      iat: 1_000,
      exp: 2_000,
      sub: CLAIMS.userId,
      sid: CLAIMS.sessionId,
    });

    assert.throws(() => verifyAccessToken(config, token, 1_000), /missing required claims/);
  });
});
