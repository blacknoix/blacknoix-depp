import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { withTenantTransaction } from "../../src/db/tenant-context";
import { createUsersRepository } from "../../src/users/repository";
import { connectDb, resetSchema, seedTenant, type DbHandles } from "./helpers";

let db: DbHandles;
let tenantA: string;
let tenantB: string;

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
});

describe("users JIT provisioning + RLS (real database)", () => {
  it("creates a user on first link and returns a stable id", async () => {
    const repo = createUsersRepository(db.app);

    const linked = await repo.findOrLinkByIdentity(tenantA, IDENTITY);

    assert.match(linked.id, /^[0-9a-f-]{36}$/i);

    const rows = await withTenantTransaction(db.app, tenantA, (trx) =>
      trx.selectFrom("users").selectAll().execute(),
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].issuer, IDENTITY.issuer);
    assert.equal(rows[0].subject, IDENTITY.subject);
  });

  it("returns the same id on re-link, with no duplicate row", async () => {
    const repo = createUsersRepository(db.app);

    const first = await repo.findOrLinkByIdentity(tenantA, IDENTITY);
    const second = await repo.findOrLinkByIdentity(tenantA, IDENTITY);

    assert.equal(second.id, first.id);

    const rows = await withTenantTransaction(db.app, tenantA, (trx) =>
      trx.selectFrom("users").selectAll().execute(),
    );
    assert.equal(rows.length, 1);
  });

  it("refreshes presentation fields on re-link while the id stays stable", async () => {
    const repo = createUsersRepository(db.app);

    const first = await repo.findOrLinkByIdentity(tenantA, IDENTITY);
    const relinked = await repo.findOrLinkByIdentity(tenantA, {
      ...IDENTITY,
      email: "alice.renamed@example.com",
      displayName: "Alice Renamed",
    });

    assert.equal(relinked.id, first.id, "email change must not change identity");

    const rows = await withTenantTransaction(db.app, tenantA, (trx) =>
      trx.selectFrom("users").selectAll().execute(),
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].email, "alice.renamed@example.com");
    assert.equal(rows[0].display_name, "Alice Renamed");
  });

  it("the same (issuer, subject) in two tenants yields two distinct users", async () => {
    const repo = createUsersRepository(db.app);

    const inA = await repo.findOrLinkByIdentity(tenantA, IDENTITY);
    const inB = await repo.findOrLinkByIdentity(tenantB, IDENTITY);

    assert.notEqual(inA.id, inB.id);

    // And RLS hides each tenant's user from the other.
    const seenByA = await withTenantTransaction(db.app, tenantA, (trx) =>
      trx.selectFrom("users").selectAll().execute(),
    );
    assert.equal(seenByA.length, 1);
    assert.equal(seenByA[0].id, inA.id);
  });

  it("fails closed: unscoped queries and empty identities are rejected", async () => {
    const repo = createUsersRepository(db.app);
    await repo.findOrLinkByIdentity(tenantA, IDENTITY);

    await assert.rejects(
      db.app.selectFrom("users").selectAll().execute(),
      /app\.current_tenant is not set/i,
    );

    await assert.rejects(
      repo.findOrLinkByIdentity(tenantA, { issuer: " ", subject: "x" }),
      /non-empty issuer and subject/,
    );
  });

  it("lists operators and checks existence within the tenant only", async () => {
    const repo = createUsersRepository(db.app);
    const alice = await repo.findOrLinkByIdentity(tenantA, IDENTITY);
    const bob = await repo.findOrLinkByIdentity(tenantA, {
      issuer: "https://idp.example.com",
      subject: "auth0|user-456",
      email: "bob@example.com",
      displayName: "Bob",
    });
    const other = await repo.findOrLinkByIdentity(tenantB, {
      issuer: "https://idp.example.com",
      subject: "auth0|user-789",
      email: "carol@example.com",
      displayName: "Carol",
    });

    assert.equal(await repo.existsInTenant(tenantA, alice.id), true);
    assert.equal(await repo.existsInTenant(tenantA, other.id), false);
    assert.equal(
      await repo.existsInTenant(tenantA, "00000000-0000-4000-8000-000000000000"),
      false,
    );

    const listed = await repo.listOperators(tenantA);
    assert.equal(listed.length, 2);
    assert.ok(listed.some((op) => op.id === alice.id && op.displayName === "Alice"));
    assert.ok(listed.some((op) => op.id === bob.id && op.email === "bob@example.com"));
    assert.ok(!listed.some((op) => op.id === other.id));
  });
});
