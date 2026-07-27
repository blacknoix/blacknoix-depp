import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { createFindingSharedViewsRepository } from "../../src/findings-views/repository";
import { withTenantTransaction } from "../../src/db/tenant-context";
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

describe("finding_shared_views (real database)", () => {
  it("isolates shared views by tenant and enforces unique names", async () => {
    const repo = createFindingSharedViewsRepository(db.app);

    const created = await repo.insert(tenantA, {
      name: "Open",
      filters: { status: "open" },
      createdByUserId: null,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const conflict = await repo.insert(tenantA, {
      name: "open",
      filters: { status: "acknowledged" },
      createdByUserId: null,
    });
    assert.equal(conflict.ok, false);
    if (conflict.ok) return;
    assert.equal(conflict.reason, "conflict");

    const other = await repo.insert(tenantB, {
      name: "Open",
      filters: { status: "open" },
      createdByUserId: null,
    });
    assert.equal(other.ok, true);

    const listA = await repo.list(tenantA);
    const listB = await repo.list(tenantB);
    assert.equal(listA.length, 1);
    assert.equal(listB.length, 1);
    assert.equal(listA[0].id, created.view.id);

    const leaked = await withTenantTransaction(db.app, tenantA, (trx) =>
      trx
        .selectFrom("finding_shared_views")
        .selectAll()
        .where("tenant_id", "=", tenantB)
        .execute(),
    );
    assert.equal(leaked.length, 0);
  });

  it("persists and lists ownerScope relative queue filters", async () => {
    const repo = createFindingSharedViewsRepository(db.app);

    const mine = await repo.insert(tenantA, {
      name: "Mine",
      filters: { ownerScope: "me" },
      createdByUserId: null,
    });
    assert.equal(mine.ok, true);
    if (!mine.ok) return;
    assert.deepEqual(mine.view.filters, { ownerScope: "me" });

    const unowned = await repo.insert(tenantA, {
      name: "Unowned open",
      filters: { ownerScope: "none", status: "open" },
      createdByUserId: null,
    });
    assert.equal(unowned.ok, true);
    if (!unowned.ok) return;
    assert.deepEqual(unowned.view.filters, {
      ownerScope: "none",
      status: "open",
    });

    const listed = await repo.list(tenantA);
    assert.equal(listed.length, 2);
    const byName = Object.fromEntries(listed.map((v) => [v.name, v.filters]));
    assert.deepEqual(byName.Mine, { ownerScope: "me" });
    assert.deepEqual(byName["Unowned open"], {
      ownerScope: "none",
      status: "open",
    });

    // Pre-ownerScope rows remain readable as empty ownership filter.
    const legacy = await repo.insert(tenantB, {
      name: "Legacy open",
      filters: { status: "open" },
      createdByUserId: null,
    });
    assert.equal(legacy.ok, true);
    if (!legacy.ok) return;
    assert.equal("ownerScope" in legacy.view.filters, false);
  });
});
