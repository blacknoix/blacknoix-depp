import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { withTenantTransaction } from "../../src/db/tenant-context";
import { createTenantsRepository } from "../../src/tenants/repository";
import { connectDb, resetSchema, seedTenant, type DbHandles } from "./helpers";

let db: DbHandles;
let tenantA: string;
let tenantB: string;

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

describe("tenants registry RLS + repository (real database)", () => {
  it("resolves a tenant to its own record", async () => {
    const repo = createTenantsRepository(db.app);

    const found = await repo.findById(tenantA);

    assert.ok(found);
    assert.equal(found.id, tenantA);
    assert.equal(found.slug, "tenant-a");
    assert.equal(found.name, "tenant-a");
  });

  it("returns undefined for a well-formed but unknown tenant id", async () => {
    const repo = createTenantsRepository(db.app);

    const found = await repo.findById("22222222-2222-4222-8222-222222222222");

    assert.equal(found, undefined);
  });

  it("returns undefined for a non-UUID id without hitting the uuid cast", async () => {
    const repo = createTenantsRepository(db.app);

    const found = await repo.findById("tenant-dev-001");

    assert.equal(found, undefined);
  });

  it("cannot read another tenant's registry row even when asking by id", async () => {
    // Under tenant A's context, RLS on tenants hides tenant B's row entirely.
    const seenByA = await withTenantTransaction(db.app, tenantA, (trx) =>
      trx.selectFrom("tenants").selectAll().execute(),
    );

    assert.equal(seenByA.length, 1);
    assert.equal(seenByA[0].id, tenantA);

    const bViaA = await withTenantTransaction(db.app, tenantA, (trx) =>
      trx.selectFrom("tenants").selectAll().where("id", "=", tenantB).execute(),
    );

    assert.equal(bViaA.length, 0);
  });
});
