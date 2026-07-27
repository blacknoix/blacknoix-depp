import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { withTenantTransaction } from "../../src/db/tenant-context";
import { connectDb, resetSchema, seedTenant, type DbHandles } from "./helpers";

let db: DbHandles;
let tenantA: string;
let tenantB: string;

before(async () => {
  // Throws loudly if the database or its env is unavailable — never skips.
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

describe("agents RLS isolation (real database)", () => {
  it("a tenant reads only its own rows", async () => {
    await withTenantTransaction(db.app, tenantA, (trx) =>
      trx.insertInto("agents").values({ tenant_id: tenantA, name: "a-1" }).execute(),
    );
    await withTenantTransaction(db.app, tenantB, (trx) =>
      trx.insertInto("agents").values({ tenant_id: tenantB, name: "b-1" }).execute(),
    );

    const seenByA = await withTenantTransaction(db.app, tenantA, (trx) =>
      trx.selectFrom("agents").selectAll().execute(),
    );

    assert.equal(seenByA.length, 1);
    assert.equal(seenByA[0].name, "a-1");
    assert.equal(seenByA[0].tenant_id, tenantA);
  });

  it("rejects an insert attributed to another tenant (WITH CHECK)", async () => {
    await assert.rejects(
      withTenantTransaction(db.app, tenantA, (trx) =>
        trx.insertInto("agents").values({ tenant_id: tenantB, name: "spoof" }).execute(),
      ),
      /row-level security|violates|policy/i,
    );

    // And nothing was written for either tenant.
    const seenByB = await withTenantTransaction(db.app, tenantB, (trx) =>
      trx.selectFrom("agents").selectAll().execute(),
    );
    assert.equal(seenByB.length, 0);
  });

  it("cannot update another tenant's row", async () => {
    await withTenantTransaction(db.app, tenantB, (trx) =>
      trx.insertInto("agents").values({ tenant_id: tenantB, name: "b-1" }).execute(),
    );

    const updated = await withTenantTransaction(db.app, tenantA, (trx) =>
      trx.updateTable("agents").set({ name: "hijacked" }).execute(),
    );
    assert.equal(updated[0].numUpdatedRows, 0n);

    const asB = await withTenantTransaction(db.app, tenantB, (trx) =>
      trx.selectFrom("agents").selectAll().execute(),
    );
    assert.equal(asB[0].name, "b-1");
  });

  it("cannot delete another tenant's row", async () => {
    await withTenantTransaction(db.app, tenantB, (trx) =>
      trx.insertInto("agents").values({ tenant_id: tenantB, name: "b-1" }).execute(),
    );

    const deleted = await withTenantTransaction(db.app, tenantA, (trx) =>
      trx.deleteFrom("agents").execute(),
    );
    assert.equal(deleted[0].numDeletedRows, 0n);

    const asB = await withTenantTransaction(db.app, tenantB, (trx) =>
      trx.selectFrom("agents").selectAll().execute(),
    );
    assert.equal(asB.length, 1);
  });

  it("fails closed when no tenant context is set", async () => {
    await withTenantTransaction(db.app, tenantA, (trx) =>
      trx.insertInto("agents").values({ tenant_id: tenantA, name: "a-1" }).execute(),
    );

    // A query outside withTenantTransaction leaves app.current_tenant with no
    // usable value. The policy's resolver must raise "app.current_tenant is not
    // set" — specifically, NOT an ''::uuid cast error, which would mean the
    // query failed for the wrong reason.
    await assert.rejects(
      db.app.selectFrom("agents").selectAll().execute(),
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        assert.match(message, /app\.current_tenant is not set/i);
        assert.doesNotMatch(message, /invalid input syntax for type uuid/i);
        return true;
      },
    );
  });

  it("the application role cannot bypass RLS", async () => {
    const { rows } = await db.migrator.query<{
      rolbypassrls: boolean;
      rolsuper: boolean;
    }>("select rolbypassrls, rolsuper from pg_roles where rolname = 'depp_app'");

    assert.equal(rows.length, 1);
    assert.equal(rows[0].rolbypassrls, false);
    assert.equal(rows[0].rolsuper, false);
  });
});
