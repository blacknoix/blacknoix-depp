import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import type { JWTVerifyGetKey } from "jose";

import type { OidcConfig } from "../src/auth/oidc/config";
import { createOidcVerifier } from "../src/auth/oidc/verifier";

const config: OidcConfig = {
  issuer: "https://idp.example.com",
  clientId: "client-123",
  clientSecret: "secret",
  redirectUri: "https://api.example.com/cb",
  tenantId: "11111111-1111-4111-8111-111111111111",
  scope: "openid email profile",
  initiationTtlSeconds: 300,
};

const NONCE = "the-stored-nonce";

type Jose = typeof import("jose");

let jose: Jose;
let keySet: JWTVerifyGetKey;
let goodPrivateKey: unknown;
let otherPrivateKey: unknown;

interface SignOpts {
  iss?: string;
  aud?: string;
  sub?: string;
  nonce?: string;
  expEpoch?: number;
  kid?: string;
}

async function sign(privateKey: unknown, claims: Record<string, unknown>, opts: SignOpts) {
  const jwt = new jose.SignJWT({ ...claims, nonce: opts.nonce ?? NONCE })
    .setProtectedHeader({ alg: "RS256", kid: opts.kid ?? "k1" })
    .setIssuer(opts.iss ?? config.issuer)
    .setAudience(opts.aud ?? config.clientId)
    .setSubject(opts.sub ?? "sub-1")
    .setIssuedAt();
  jwt.setExpirationTime(opts.expEpoch ?? Math.floor(Date.now() / 1000) + 300);
  return jwt.sign(privateKey as Parameters<typeof jwt.sign>[0]);
}

before(async () => {
  jose = await import("jose");
  const good = await jose.generateKeyPair("RS256");
  const other = await jose.generateKeyPair("RS256");
  goodPrivateKey = good.privateKey;
  otherPrivateKey = other.privateKey;
  const jwk = { ...(await jose.exportJWK(good.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  keySet = jose.createLocalJWKSet({ keys: [jwk] });
});

/** Records the code_verifier the verifier passed into the exchange. */
function verifierFor(idToken: string, seen?: { codeVerifier?: string }) {
  return createOidcVerifier(config, {
    exchangeCode: async (_code, codeVerifier) => {
      if (seen) seen.codeVerifier = codeVerifier;
      return idToken;
    },
    keySet,
  });
}

const CALLBACK = { code: "auth-code", codeVerifier: "pkce-verifier-xyz", nonce: NONCE };

describe("OIDC verifier (local key set)", () => {
  it("returns a verified identity and forwards the PKCE verifier to the exchange", async () => {
    const token = await sign(goodPrivateKey, { email: "a@b.com", email_verified: true, name: "Al" }, {});
    const seen: { codeVerifier?: string } = {};

    const identity = await verifierFor(token, seen).verifyCallback(CALLBACK);

    assert.equal(identity.subject, "sub-1");
    assert.equal(identity.email, "a@b.com");
    assert.equal(seen.codeVerifier, "pkce-verifier-xyz", "PKCE verifier must reach the exchange");
  });

  it("rejects a nonce mismatch even when the signature is otherwise valid", async () => {
    // Signature/issuer/audience all valid, but the token's nonce differs.
    const token = await sign(goodPrivateKey, {}, { nonce: "a-different-nonce" });
    await assert.rejects(() => verifierFor(token).verifyCallback(CALLBACK), /nonce does not match/);
  });

  it("rejects a missing nonce claim", async () => {
    const token = await new jose.SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(config.issuer)
      .setAudience(config.clientId)
      .setSubject("sub-1")
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + 300)
      .sign(goodPrivateKey as Parameters<InstanceType<typeof jose.SignJWT>["sign"]>[0]);
    await assert.rejects(() => verifierFor(token).verifyCallback(CALLBACK), /nonce does not match/);
  });

  it("rejects wrong issuer / audience / expiry / bad signature / unknown kid", async () => {
    const wrongIss = await sign(goodPrivateKey, {}, { iss: "https://evil.example.com" });
    await assert.rejects(() => verifierFor(wrongIss).verifyCallback(CALLBACK), /verification failed/);

    const wrongAud = await sign(goodPrivateKey, {}, { aud: "other" });
    await assert.rejects(() => verifierFor(wrongAud).verifyCallback(CALLBACK), /verification failed/);

    const expired = await sign(goodPrivateKey, {}, { expEpoch: Math.floor(Date.now() / 1000) - 60 });
    await assert.rejects(() => verifierFor(expired).verifyCallback(CALLBACK), /verification failed/);

    const badSig = await sign(otherPrivateKey, {}, { kid: "k1" });
    await assert.rejects(() => verifierFor(badSig).verifyCallback(CALLBACK), /verification failed/);

    const unknownKid = await sign(goodPrivateKey, {}, { kid: "nope" });
    await assert.rejects(() => verifierFor(unknownKid).verifyCallback(CALLBACK), /verification failed/);
  });

  it("rejects a malformed token response", async () => {
    await assert.rejects(() => verifierFor("not-a-jwt").verifyCallback(CALLBACK), /verification failed/);
  });

  it("omits email when it is not verified", async () => {
    const token = await sign(goodPrivateKey, { email: "a@b.com", email_verified: false }, {});
    const identity = await verifierFor(token).verifyCallback(CALLBACK);
    assert.equal(identity.email, undefined);
  });
});
