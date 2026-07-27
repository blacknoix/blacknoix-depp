import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { withTenantTransaction } from "../../src/db/tenant-context";
import { hashRefreshToken } from "../../src/sessions/refresh-token";
import { createSessionsRepository } from "../../src/sessions/repository";
import { createUsersRepository } from "../../src/users/repository";
import { connectDb, resetSchema, seedTenant, type DbHandles } from "./helpers";

let db: DbHandles;
let tenantA: string;
let tenantB: string;
let userA: string;

const IDENTITY = {
  issuer: "https://idp.example.com",
  subject: "auth0|user-123",
  email: "alice@example.com",
  displayName: "Alice",
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
  tenantB = await seedTenant(db.migrator, "tenant-b");
  userA = (await createUsersRepository(db.app).findOrLinkByIdentity(tenantA, IDENTITY)).id;
});

describe("session + refresh-token lifecycle (real database)", () => {
  it("creates a session with an initial refresh token, storing only the hash", async () => {
    const repo = createSessionsRepository(db.app);

    const created = await repo.createSession(tenantA, userA);

    assert.match(created.sessionId, /^[0-9a-f-]{36}$/i);
    assert.ok(created.refreshToken.length > 0);

    const rows = await withTenantTransaction(db.app, tenantA, (trx) =>
      trx.selectFrom("refresh_tokens").selectAll().execute(),
    );
    assert.equal(rows.length, 1);
    // The plaintext must never be persisted; only its hash.
    assert.equal(rows[0].token_hash, hashRefreshToken(created.refreshToken));
    assert.notEqual(rows[0].token_hash, created.refreshToken);
    assert.equal(rows[0].consumed_at, null);
  });

  it("consumes a valid refresh token and rotates to a new one", async () => {
    const repo = createSessionsRepository(db.app);
    const created = await repo.createSession(tenantA, userA);

    const rotated = await repo.rotateRefreshToken(tenantA, created.refreshToken);

    assert.equal(rotated.ok, true);
    if (rotated.ok) {
      assert.equal(rotated.sessionId, created.sessionId);
      assert.notEqual(rotated.refreshToken, created.refreshToken);
    }

    // Old token is now consumed; the new one is usable.
    const tokens = await withTenantTransaction(db.app, tenantA, (trx) =>
      trx.selectFrom("refresh_tokens").select(["token_hash", "consumed_at"]).execute(),
    );
    const oldHash = hashRefreshToken(created.refreshToken);
    const oldRow = tokens.find((t) => t.token_hash === oldHash);
    const newRows = tokens.filter((t) => t.token_hash !== oldHash);

    assert.notEqual(oldRow?.consumed_at, null);
    assert.equal(newRows.length, 1);
    assert.equal(newRows[0].consumed_at, null);
  });

  it("rejects replay of an already-consumed token", async () => {
    const repo = createSessionsRepository(db.app);
    const created = await repo.createSession(tenantA, userA);

    await repo.rotateRefreshToken(tenantA, created.refreshToken); // consumes it
    const replay = await repo.rotateRefreshToken(tenantA, created.refreshToken);

    assert.deepEqual(replay, { ok: false, reason: "replayed" });
  });

  it("rejects an unknown token as invalid", async () => {
    const repo = createSessionsRepository(db.app);

    const result = await repo.rotateRefreshToken(tenantA, "not-a-real-token");

    assert.deepEqual(result, { ok: false, reason: "invalid" });
  });

  it("rejects refresh for a revoked session, even with an otherwise-valid token", async () => {
    const repo = createSessionsRepository(db.app);
    const created = await repo.createSession(tenantA, userA);

    const revoked = await repo.revokeSession(tenantA, created.sessionId);
    assert.equal(revoked, true);

    const result = await repo.rotateRefreshToken(tenantA, created.refreshToken);
    assert.deepEqual(result, { ok: false, reason: "session_revoked" });
  });

  it("isolates sessions by tenant and fails closed without context", async () => {
    const repo = createSessionsRepository(db.app);
    const created = await repo.createSession(tenantA, userA);

    // Tenant B cannot see or rotate tenant A's token.
    const asB = await repo.rotateRefreshToken(tenantB, created.refreshToken);
    assert.deepEqual(asB, { ok: false, reason: "invalid" });

    const bSessions = await withTenantTransaction(db.app, tenantB, (trx) =>
      trx.selectFrom("sessions").selectAll().execute(),
    );
    assert.equal(bSessions.length, 0);

    // Unscoped query fails closed rather than returning rows.
    await assert.rejects(
      db.app.selectFrom("sessions").selectAll().execute(),
      /app\.current_tenant is not set/i,
    );
  });

  it("cannot anchor a session to another tenant's user (composite FK)", async () => {
    const repo = createSessionsRepository(db.app);
    const userB = (
      await createUsersRepository(db.app).findOrLinkByIdentity(tenantB, IDENTITY)
    ).id;

    // Under tenant A, referencing tenant B's user id must violate the composite
    // foreign key — the (tenant_id, user_id) pair does not exist in users.
    await assert.rejects(
      repo.createSession(tenantA, userB),
      /foreign key|violates/i,
    );
  });
});
