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
});
