import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import type { OidcConfig } from "../../src/auth/oidc/config";
import { createOidcLoginService } from "../../src/auth/oidc/login";
import { createDbInitiationStore } from "../../src/auth/oidc/store-db";
import type { OidcCallbackParams, OidcVerifier } from "../../src/auth/oidc/verifier";
import type { FederatedIdentity } from "../../src/users/repository";
import { connectDb, resetSchema, seedTenant, type DbHandles } from "./helpers";

let db: DbHandles;
let tenantA: string;

const IDENTITY: FederatedIdentity = { issuer: "https://idp.example.com", subject: "sub-1" };

// Fixed generators so the values persisted at start can be asserted at complete.
const GEN = {
  state: () => "STATE-DB",
  nonce: () => "NONCE-DB",
  pkce: () => ({ verifier: "VERIFIER-DB", challenge: "CHALLENGE-DB" }),
};

before(async () => {
  db = await connectDb();
});

after(async () => {
  if (db) {
    await db.close();
  }
});

beforeEach(async () => {
  await resetSchema(db.migrator);
  tenantA = await seedTenant(db.migrator, "tenant-a");
});

function config(): OidcConfig {
  return {
    issuer: "https://idp.example.com",
    clientId: "client-123",
    clientSecret: "secret",
    redirectUri: "https://api.example.com/v1/auth/oidc/callback",
    tenantId: tenantA,
    scope: "openid email profile",
    initiationTtlSeconds: 300,
  };
}

describe("OIDC login service over the Postgres store", () => {
  it("binds start -> DB record -> callback verifier and rejects replay", async () => {
    const seen: OidcCallbackParams[] = [];
    const verifier: OidcVerifier = {
      async verifyCallback(params) {
        seen.push(params);
        return IDENTITY;
      },
    };

    const service = createOidcLoginService({
      config: config(),
      store: createDbInitiationStore(db.app),
      verifier,
      authorizationEndpoint: async () => "https://idp.example.com/authorize",
      generate: GEN,
    });

    // start persists the record to Postgres.
    const { redirectUrl } = await service.start();
    const state = new URL(redirectUrl).searchParams.get("state");
    assert.equal(state, "STATE-DB");

    // complete reads it back and forwards the *stored* PKCE verifier + nonce.
    const result = await service.complete({ state: "STATE-DB", code: "auth-code" });

    assert.deepEqual(result, { tenantId: tenantA, identity: IDENTITY });
    assert.deepEqual(seen, [
      { code: "auth-code", codeVerifier: "VERIFIER-DB", nonce: "NONCE-DB" },
    ]);

    // Replay of the same state after a successful login is rejected.
    await assert.rejects(
      () => service.complete({ state: "STATE-DB", code: "auth-code" }),
      /No live initiation record/,
    );
    assert.equal(seen.length, 1, "verifier must not run on the replay");
  });
});
