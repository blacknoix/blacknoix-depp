import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { withTenantTransaction } from "../../src/db/tenant-context";
import { createTelemetryRepository } from "../../src/telemetry/repository";
import { createTelemetryService } from "../../src/telemetry/service";
import { connectDb, resetSchema, seedTenant, type DbHandles } from "../db/helpers";

let db: DbHandles;
let tenantA: string;
let tenantB: string;
let agentA: string;
let agentB: string;

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

  const insertedA = await withTenantTransaction(db.app, tenantA, (trx) =>
    trx
      .insertInto("agents")
      .values({ tenant_id: tenantA, name: "a-1" })
      .returning("id")
      .executeTakeFirstOrThrow(),
  );
  const insertedB = await withTenantTransaction(db.app, tenantB, (trx) =>
    trx
      .insertInto("agents")
      .values({ tenant_id: tenantB, name: "b-1" })
      .returning("id")
      .executeTakeFirstOrThrow(),
  );

  agentA = insertedA.id;
  agentB = insertedB.id;
});

describe("telemetry_events persistence and isolation", () => {
  it("inserts and lists events under the authenticated tenant", async () => {
    const repo = createTelemetryRepository(db.app);
    const service = createTelemetryService({ telemetry: repo });

    const outcome = await service.ingest(tenantA, {
      schemaVersion: 1,
      agentId: agentA,
      eventType: "heartbeat",
      occurredAt: new Date(),
      payload: { status: "ok" },
    });

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;

    const listed = await repo.listRecentByTenant(tenantA);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, outcome.event.id);
    assert.equal(listed[0].tenantId, tenantA);
    assert.equal(listed[0].agentId, agentA);
    assert.equal(listed[0].eventType, "heartbeat");
    assert.deepEqual(listed[0].payload, { status: "ok" });
  });

  it("does not expose another tenant's events", async () => {
    const repo = createTelemetryRepository(db.app);
    const service = createTelemetryService({ telemetry: repo });

    await service.ingest(tenantB, {
      schemaVersion: 1,
      agentId: agentB,
      eventType: "agent.started",
      occurredAt: new Date(),
      payload: {},
    });

    const seenByA = await repo.listRecentByTenant(tenantA);
    assert.equal(seenByA.length, 0);

    const seenByB = await repo.listRecentByTenant(tenantB);
    assert.equal(seenByB.length, 1);
  });

  it("rejects ingest for an agent that is not in the tenant", async () => {
    const repo = createTelemetryRepository(db.app);
    const service = createTelemetryService({ telemetry: repo });

    const outcome = await service.ingest(tenantA, {
      schemaVersion: 1,
      agentId: agentB,
      eventType: "heartbeat",
      occurredAt: new Date(),
      payload: {},
    });

    assert.deepEqual(outcome, { ok: false, reason: "agent_not_found" });

    const listed = await repo.listRecentByTenant(tenantA);
    assert.equal(listed.length, 0);
  });

  it("rejects a cross-tenant tenant_id on insert (WITH CHECK)", async () => {
    await assert.rejects(
      withTenantTransaction(db.app, tenantA, (trx) =>
        trx
          .insertInto("telemetry_events")
          .values({
            tenant_id: tenantB,
            agent_id: agentB,
            schema_version: 1,
            event_type: "heartbeat",
            occurred_at: new Date(),
            payload: {},
          })
          .execute(),
      ),
      /row-level security|violates|policy|foreign key/i,
    );
  });

  it("fails closed when no tenant context is set", async () => {
    await withTenantTransaction(db.app, tenantA, (trx) =>
      trx
        .insertInto("telemetry_events")
        .values({
          tenant_id: tenantA,
          agent_id: agentA,
          schema_version: 1,
          event_type: "heartbeat",
          occurred_at: new Date(),
          payload: {},
        })
        .execute(),
    );

    await assert.rejects(
      db.app.selectFrom("telemetry_events").selectAll().execute(),
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        assert.match(message, /app\.current_tenant is not set/i);
        assert.doesNotMatch(message, /invalid input syntax for type uuid/i);
        return true;
      },
    );
  });

  it("ingests a batch atomically under one tenant", async () => {
    const repo = createTelemetryRepository(db.app);
    const service = createTelemetryService({ telemetry: repo });

    const outcome = await service.ingestBatch(tenantA, [
      {
        schemaVersion: 1,
        agentId: agentA,
        eventType: "heartbeat",
        occurredAt: new Date(),
        payload: { n: 1 },
      },
      {
        schemaVersion: 1,
        agentId: agentA,
        eventType: "agent.started",
        occurredAt: new Date(),
        payload: { n: 2 },
      },
    ]);

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.events.length, 2);

    const listed = await repo.listRecentByTenant(tenantA);
    assert.equal(listed.length, 2);
    assert.equal(listed.every((row) => row.tenantId === tenantA), true);
    assert.equal(listed.every((row) => row.agentId === agentA), true);
  });
});

describe("telemetry query and summary", () => {
  it("returns empty list and zeroed summary when the agent has no events", async () => {
    const repo = createTelemetryRepository(db.app);
    const service = createTelemetryService({ telemetry: repo });

    const outcome = await service.query(tenantA, {
      agentId: agentA,
      limit: 50,
      offset: 0,
    });

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.result.events.length, 0);
    assert.equal(outcome.result.summary.totalInWindow, 0);
    assert.equal(outcome.result.summary.lastSeenAt, null);
    assert.equal(outcome.result.summary.lastHeartbeatAt, null);
    assert.deepEqual(outcome.result.summary.countsByEventType, {});
  });

  it("lists recent events with summary counts and last heartbeat", async () => {
    const repo = createTelemetryRepository(db.app);
    const service = createTelemetryService({ telemetry: repo });

    const t0 = new Date("2026-03-01T10:00:00.000Z");
    const t1 = new Date("2026-03-01T11:00:00.000Z");
    const t2 = new Date("2026-03-01T12:00:00.000Z");

    await service.ingestBatch(tenantA, [
      {
        schemaVersion: 1,
        agentId: agentA,
        eventType: "agent.started",
        occurredAt: t0,
        payload: {},
      },
      {
        schemaVersion: 1,
        agentId: agentA,
        eventType: "heartbeat",
        occurredAt: t1,
        payload: {},
      },
      {
        schemaVersion: 1,
        agentId: agentA,
        eventType: "heartbeat",
        occurredAt: t2,
        payload: {},
      },
    ]);

    const outcome = await service.query(tenantA, {
      agentId: agentA,
      limit: 50,
      offset: 0,
    });

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.result.events.length, 3);
    assert.equal(outcome.result.events[0].occurredAt.toISOString(), t2.toISOString());
    assert.equal(outcome.result.summary.totalInWindow, 3);
    assert.equal(outcome.result.summary.countsByEventType.heartbeat, 2);
    assert.equal(outcome.result.summary.countsByEventType["agent.started"], 1);
    assert.equal(
      outcome.result.summary.lastHeartbeatAt?.toISOString(),
      t2.toISOString(),
    );
    assert.ok(outcome.result.summary.lastSeenAt);
  });

  it("filters by eventType and time window and respects pagination", async () => {
    const repo = createTelemetryRepository(db.app);
    const service = createTelemetryService({ telemetry: repo });

    const times = [
      new Date("2026-03-10T01:00:00.000Z"),
      new Date("2026-03-10T02:00:00.000Z"),
      new Date("2026-03-10T03:00:00.000Z"),
      new Date("2026-03-10T04:00:00.000Z"),
    ];

    await service.ingestBatch(tenantA, [
      {
        schemaVersion: 1,
        agentId: agentA,
        eventType: "heartbeat",
        occurredAt: times[0],
        payload: {},
      },
      {
        schemaVersion: 1,
        agentId: agentA,
        eventType: "heartbeat",
        occurredAt: times[1],
        payload: {},
      },
      {
        schemaVersion: 1,
        agentId: agentA,
        eventType: "agent.started",
        occurredAt: times[2],
        payload: {},
      },
      {
        schemaVersion: 1,
        agentId: agentA,
        eventType: "heartbeat",
        occurredAt: times[3],
        payload: {},
      },
    ]);

    const filtered = await service.query(tenantA, {
      agentId: agentA,
      eventType: "heartbeat",
      since: times[1],
      until: times[3],
      limit: 1,
      offset: 0,
    });

    assert.equal(filtered.ok, true);
    if (!filtered.ok) return;
    assert.equal(filtered.result.events.length, 1);
    assert.equal(
      filtered.result.events[0].occurredAt.toISOString(),
      times[3].toISOString(),
    );
    assert.equal(filtered.result.summary.totalInWindow, 2);
    assert.equal(filtered.result.summary.countsByEventType.heartbeat, 2);
    assert.equal(
      filtered.result.summary.lastHeartbeatAt?.toISOString(),
      times[3].toISOString(),
    );

    const page2 = await service.query(tenantA, {
      agentId: agentA,
      eventType: "heartbeat",
      since: times[1],
      until: times[3],
      limit: 1,
      offset: 1,
    });
    assert.equal(page2.ok, true);
    if (!page2.ok) return;
    assert.equal(page2.result.events.length, 1);
    assert.equal(
      page2.result.events[0].occurredAt.toISOString(),
      times[1].toISOString(),
    );
  });

  it("does not expose another tenant's events via query", async () => {
    const repo = createTelemetryRepository(db.app);
    const service = createTelemetryService({ telemetry: repo });

    await service.ingest(tenantB, {
      schemaVersion: 1,
      agentId: agentB,
      eventType: "heartbeat",
      occurredAt: new Date(),
      payload: {},
    });

    const crossAgent = await service.query(tenantA, {
      agentId: agentB,
      limit: 50,
      offset: 0,
    });
    assert.deepEqual(crossAgent, { ok: false, reason: "agent_not_found" });

    const ownEmpty = await service.query(tenantA, {
      agentId: agentA,
      limit: 50,
      offset: 0,
    });
    assert.equal(ownEmpty.ok, true);
    if (!ownEmpty.ok) return;
    assert.equal(ownEmpty.result.events.length, 0);
    assert.equal(ownEmpty.result.summary.totalInWindow, 0);
  });
});
