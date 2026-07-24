import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createInMemoryInitiationStore,
  type OidcInitiationRecord,
} from "../src/auth/oidc/store";

function record(overrides: Partial<OidcInitiationRecord> = {}): OidcInitiationRecord {
  const createdAt = overrides.createdAt ?? 1_000;
  return {
    state: "state-1",
    nonce: "nonce-1",
    codeVerifier: "verifier-1",
    tenantId: "11111111-1111-4111-8111-111111111111",
    createdAt,
    expiresAt: overrides.expiresAt ?? createdAt + 300_000,
    ...overrides,
  };
}

describe("in-memory initiation store", () => {
  it("returns a live record exactly once (single-use / replay rejected)", async () => {
    const store = createInMemoryInitiationStore();
    await store.put(record());

    const first = await store.consume("state-1", 1_100);
    const second = await store.consume("state-1", 1_100);

    assert.equal(first?.state, "state-1");
    assert.equal(second, undefined, "a consumed state cannot be reused");
  });

  it("returns undefined for an unknown state", async () => {
    const store = createInMemoryInitiationStore();
    assert.equal(await store.consume("nope", 1_000), undefined);
  });

  it("rejects an expired record and does not leave it consumable", async () => {
    const store = createInMemoryInitiationStore();
    await store.put(record({ createdAt: 1_000, expiresAt: 2_000 }));

    assert.equal(await store.consume("state-1", 2_001), undefined, "expired -> rejected");
    assert.equal(await store.consume("state-1", 1_500), undefined, "and removed, not usable later");
  });
});
