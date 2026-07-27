import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { OidcConfig } from "../src/auth/oidc/config";
import { createOidcLoginService } from "../src/auth/oidc/login";
import type {
  OidcInitiationRecord,
  OidcInitiationStore,
} from "../src/auth/oidc/store";
import type { OidcCallbackParams, OidcVerifier } from "../src/auth/oidc/verifier";
import type { FederatedIdentity } from "../src/users/repository";

const config: OidcConfig = {
  issuer: "https://idp.example.com",
  clientId: "client-123",
  clientSecret: "secret",
  redirectUri: "https://api.example.com/v1/auth/oidc/callback",
  tenantId: "11111111-1111-4111-8111-111111111111",
  scope: "openid email profile",
  initiationTtlSeconds: 300,
};

const IDENTITY: FederatedIdentity = { issuer: config.issuer, subject: "sub-1" };

/** Store spy that captures puts and can be primed to return a record on consume. */
function spyStore(primed?: OidcInitiationRecord) {
  const puts: OidcInitiationRecord[] = [];
  const consumed: string[] = [];
  const store: OidcInitiationStore = {
    async put(record) {
      puts.push(record);
    },
    async consume(state) {
      consumed.push(state);
      return primed && primed.state === state ? primed : undefined;
    },
  };
  return { store, puts, consumed };
}

const GEN = {
  state: () => "STATE",
  nonce: () => "NONCE",
  pkce: () => ({ verifier: "VERIFIER", challenge: "CHALLENGE" }),
};

describe("OIDC login service — start", () => {
  it("stores an initiation record and builds a correct authorization URL", async () => {
    const { store, puts } = spyStore();
    const service = createOidcLoginService({
      config,
      store,
      verifier: { verifyCallback: async () => IDENTITY },
      authorizationEndpoint: async () => "https://idp.example.com/authorize",
      now: () => 10_000,
      generate: GEN,
    });

    const { redirectUrl } = await service.start();

    // Record persisted with server-owned tenant + TTL.
    assert.equal(puts.length, 1);
    assert.deepEqual(
      { ...puts[0] },
      {
        state: "STATE",
        nonce: "NONCE",
        codeVerifier: "VERIFIER",
        tenantId: config.tenantId,
        createdAt: 10_000,
        expiresAt: 10_000 + 300 * 1000,
      },
    );

    const url = new URL(redirectUrl);
    assert.equal(url.origin + url.pathname, "https://idp.example.com/authorize");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("client_id"), config.clientId);
    assert.equal(url.searchParams.get("redirect_uri"), config.redirectUri);
    assert.match(url.searchParams.get("scope") ?? "", /\bopenid\b/);
    assert.equal(url.searchParams.get("state"), "STATE");
    assert.equal(url.searchParams.get("nonce"), "NONCE");
    assert.equal(url.searchParams.get("code_challenge"), "CHALLENGE");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  });
});

describe("OIDC login service — complete", () => {
  const record: OidcInitiationRecord = {
    state: "STATE",
    nonce: "NONCE",
    codeVerifier: "VERIFIER",
    tenantId: config.tenantId,
    createdAt: 0,
    expiresAt: 9_999_999_999_999,
  };

  it("passes the stored PKCE verifier and nonce to the verifier and returns the tenant", async () => {
    const { store } = spyStore(record);
    const seen: OidcCallbackParams[] = [];
    const verifier: OidcVerifier = {
      async verifyCallback(params) {
        seen.push(params);
        return IDENTITY;
      },
    };

    const service = createOidcLoginService({
      config,
      store,
      verifier,
      authorizationEndpoint: async () => "https://idp.example.com/authorize",
    });

    const result = await service.complete({ state: "STATE", code: "auth-code" });

    assert.deepEqual(result, { tenantId: config.tenantId, identity: IDENTITY });
    assert.deepEqual(seen, [
      { code: "auth-code", codeVerifier: "VERIFIER", nonce: "NONCE" },
    ]);
  });

  it("fails closed when the store is unavailable (never calls the verifier)", async () => {
    let verifierCalled = false;
    const store: OidcInitiationStore = {
      async put() {},
      async consume() {
        throw new Error("store unavailable");
      },
    };
    const service = createOidcLoginService({
      config,
      store,
      verifier: {
        async verifyCallback() {
          verifierCalled = true;
          return IDENTITY;
        },
      },
      authorizationEndpoint: async () => "https://idp.example.com/authorize",
    });

    await assert.rejects(
      () => service.complete({ state: "STATE", code: "auth-code" }),
      /store unavailable/,
    );
    assert.equal(verifierCalled, false, "no identity may cross when the store fails");
  });

  it("rejects when no live initiation record matches (missing / expired / consumed / unknown)", async () => {
    const { store } = spyStore(undefined); // consume always returns undefined
    let verifierCalled = false;
    const service = createOidcLoginService({
      config,
      store,
      verifier: {
        async verifyCallback() {
          verifierCalled = true;
          return IDENTITY;
        },
      },
      authorizationEndpoint: async () => "https://idp.example.com/authorize",
    });

    await assert.rejects(
      () => service.complete({ state: "STATE", code: "auth-code" }),
      /No live initiation record/,
    );
    assert.equal(verifierCalled, false, "verification must not run without a matched record");
  });
});
