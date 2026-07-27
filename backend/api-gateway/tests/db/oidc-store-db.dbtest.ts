import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import {
  createDbInitiationStore,
  deleteExpiredInitiations,
} from "../../src/auth/oidc/store-db";
import { generateState } from "../../src/auth/oidc/pkce";
import type { OidcInitiationRecord } from "../../src/auth/oidc/store";
import { connectDb, resetSchema, seedTenant, type DbHandles } from "./helpers";

let db: DbHandles;
let tenantA: string;

function record(state: string, overrides: Partial<OidcInitiationRecord> = {}): OidcInitiationRecord {
  const createdAt = Date.now();
  return {
    state,
    nonce: `nonce-${state}`,
    codeVerifier: `verifier-${state}`,
    tenantId: tenantA,
    createdAt,
    expiresAt: createdAt + 300_000,
    ...overrides,
  };
}

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

describe("Postgres initiation store", () => {
  it("round-trips all fields and consumes once", async () => {
    const store = createDbInitiationStore(db.app);
    const state = generateState();
    await store.put(record(state));

    const consumed = await store.consume(state);
    assert.ok(consumed);
    assert.equal(consumed.nonce, `nonce-${state}`);
    assert.equal(consumed.codeVerifier, `verifier-${state}`);
    assert.equal(consumed.tenantId, tenantA);
    assert.equal(consumed.state, state);
  });

  it("is single-use: a second consume returns undefined (replay rejected)", async () => {
    const store = createDbInitiationStore(db.app);
    const state = generateState();
    await store.put(record(state));

    assert.ok(await store.consume(state));
    assert.equal(await store.consume(state), undefined);
  });

  it("rejects an expired record", async () => {
    const store = createDbInitiationStore(db.app);
    const state = generateState();
    await store.put(record(state, { expiresAt: Date.now() - 1_000 }));

    assert.equal(await store.consume(state), undefined);
    // And the row was cleaned up by the consume attempt.
    assert.equal(await store.consume(state), undefined);
  });

  it("returns undefined for an unknown state", async () => {
    const store = createDbInitiationStore(db.app);
    assert.equal(await store.consume(generateState()), undefined);
  });

  it("allows only one concurrent consume of the same state to succeed", async () => {
    const store = createDbInitiationStore(db.app);
    const state = generateState();
    await store.put(record(state));

    const results = await Promise.all(
      Array.from({ length: 8 }, () => store.consume(state)),
    );
    const winners = results.filter((r) => r !== undefined);

    assert.equal(winners.length, 1, "exactly one concurrent consume may win");
  });

  it("deleteExpiredInitiations removes expired rows and keeps live ones", async () => {
    const store = createDbInitiationStore(db.app);
    const live = generateState();
    const dead = generateState();
    await store.put(record(live));
    await store.put(record(dead, { expiresAt: Date.now() - 1_000 }));

    const removed = await deleteExpiredInitiations(db.app);
    assert.equal(removed, 1);
    assert.ok(await store.consume(live), "live record survives cleanup");
  });
});
