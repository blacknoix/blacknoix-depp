import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { withTenantTransaction } from "../../src/db/tenant-context";
import { createWorkSharedViewsRepository } from "../../src/work-views/repository";
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

describe("work_shared_views + tenant default (real database)", () => {
  it("isolates shared Work views by tenant and enforces unique names", async () => {
    const repo = createWorkSharedViewsRepository(db.app);

    const created = await repo.insert(tenantA, {
      name: "Intake",
      definition: { sections: ["unowned_open"] },
      createdByUserId: null,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const conflict = await repo.insert(tenantA, {
      name: "intake",
      definition: { sections: ["mine"] },
      createdByUserId: null,
    });
    assert.equal(conflict.ok, false);
    if (conflict.ok) return;
    assert.equal(conflict.reason, "conflict");

    const other = await repo.insert(tenantB, {
      name: "Intake",
      definition: { sections: ["unowned_open"] },
      createdByUserId: null,
    });
    assert.equal(other.ok, true);

    const listA = await repo.list(tenantA);
    const listB = await repo.list(tenantB);
    assert.equal(listA.length, 1);
    assert.equal(listB.length, 1);
    assert.equal(listA[0].id, created.view.id);
    assert.deepEqual(listA[0].definition.sections, ["unowned_open"]);

    const leaked = await withTenantTransaction(db.app, tenantA, (trx) =>
      trx
        .selectFrom("work_shared_views")
        .selectAll()
        .where("tenant_id", "=", tenantB)
        .execute(),
    );
    assert.equal(leaked.length, 0);
  });

  it("sets, reads, and clears a tenant default pointing at a shared view", async () => {
    const repo = createWorkSharedViewsRepository(db.app);
    const created = await repo.insert(tenantA, {
      name: "Mine focus",
      definition: { sections: ["mine", "action_needed"] },
      createdByUserId: null,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    assert.equal(await repo.getDefaultViewId(tenantA), null);

    const missing = await repo.setDefaultViewId(
      tenantA,
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      null,
    );
    assert.equal(missing.ok, false);
    if (missing.ok) return;
    assert.equal(missing.reason, "not_found");

    const set = await repo.setDefaultViewId(tenantA, created.view.id, null);
    assert.equal(set.ok, true);
    if (!set.ok) return;
    assert.equal(set.defaultViewId, created.view.id);
    assert.equal(await repo.getDefaultViewId(tenantA), created.view.id);

    // Replace with a second view.
    const second = await repo.insert(tenantA, {
      name: "Unowned",
      definition: { sections: ["unowned_open"] },
      createdByUserId: null,
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;

    const replaced = await repo.setDefaultViewId(
      tenantA,
      second.view.id,
      null,
    );
    assert.equal(replaced.ok, true);
    assert.equal(await repo.getDefaultViewId(tenantA), second.view.id);

    const cleared = await repo.clearDefaultViewId(tenantA);
    assert.equal(cleared, second.view.id);
    assert.equal(await repo.getDefaultViewId(tenantA), null);
  });

  it("clears the tenant default when the referenced shared view is deleted", async () => {
    const repo = createWorkSharedViewsRepository(db.app);
    const created = await repo.insert(tenantA, {
      name: "Default me",
      definition: { sections: ["reminders_due"] },
      createdByUserId: null,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const set = await repo.setDefaultViewId(tenantA, created.view.id, null);
    assert.equal(set.ok, true);
    assert.equal(await repo.getDefaultViewId(tenantA), created.view.id);

    const deleted = await repo.deleteById(tenantA, created.view.id);
    assert.ok(deleted);
    assert.equal(await repo.getDefaultViewId(tenantA), null);
    assert.equal((await repo.list(tenantA)).length, 0);
  });

  it("cannot point a tenant default at another tenant's shared view", async () => {
    const repo = createWorkSharedViewsRepository(db.app);
    const inB = await repo.insert(tenantB, {
      name: "B only",
      definition: { sections: ["mine"] },
      createdByUserId: null,
    });
    assert.equal(inB.ok, true);
    if (!inB.ok) return;

    const cross = await repo.setDefaultViewId(tenantA, inB.view.id, null);
    assert.equal(cross.ok, false);
    if (cross.ok) return;
    assert.equal(cross.reason, "not_found");
    assert.equal(await repo.getDefaultViewId(tenantA), null);
  });

  it("fails closed when no tenant context is set", async () => {
    const repo = createWorkSharedViewsRepository(db.app);
    const created = await repo.insert(tenantA, {
      name: "Scoped",
      definition: { sections: ["mine"] },
      createdByUserId: null,
    });
    assert.equal(created.ok, true);

    await assert.rejects(
      db.app.selectFrom("work_shared_views").selectAll().execute(),
      /app\.current_tenant is not set/i,
    );
    await assert.rejects(
      db.app.selectFrom("work_tenant_defaults").selectAll().execute(),
      /app\.current_tenant is not set/i,
    );
  });
});
