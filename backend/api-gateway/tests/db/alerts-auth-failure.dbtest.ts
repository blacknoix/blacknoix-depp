import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import {
  AUTH_FAILURE_BURST_THRESHOLD,
  AUTH_FAILURE_BURST_RULE_ID,
  floorToAuthFailureWindowBucket,
} from "../../src/alerts/rule";
import {
  createAlertsRepository,
  type AlertsRepository,
} from "../../src/alerts/repository";
import { createAlertsService } from "../../src/alerts/service";
import { withTenantTransaction } from "../../src/db/tenant-context";
import { parseTelemetryEventV1 } from "../../src/telemetry/contract";
import { createTelemetryRepository } from "../../src/telemetry/repository";
import { createTelemetryService } from "../../src/telemetry/service";
import { connectDb, resetSchema, seedTenant, type DbHandles } from "./helpers";

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

function wireServices(hooks?: {
  beforeAuditInsert?: () => void;
}): {
  telemetry: ReturnType<typeof createTelemetryService>;
  alerts: AlertsRepository;
  alertsApi: ReturnType<typeof createAlertsService>;
} {
  const telemetryRepo = createTelemetryRepository(db.app);
  const alerts = createAlertsRepository(db.app, hooks ?? {});
  const telemetry = createTelemetryService({
    telemetry: telemetryRepo,
    authFailureAlerts: alerts,
  });
  const alertsApi = createAlertsService({ alerts });
  return { telemetry, alerts, alertsApi };
}

/** Fixed occurredAt inside one 5-minute bucket (deterministic, no sleep). */
function bucketBase(): Date {
  return new Date("2026-03-01T12:00:00.000Z");
}

function occurredInBucket(offsetMs: number): Date {
  const base = floorToAuthFailureWindowBucket(bucketBase());
  return new Date(base.getTime() + offsetMs);
}

describe("telemetry-to-auditable-alert-v1 acceptance", () => {
  it("1. server-derived tenancy: body tenantId rejected; persisted tenant is principal", async () => {
    const { telemetry } = wireServices();

    // Established contract: tenant identity in the body is rejected at parse.
    const parsed = parseTelemetryEventV1({
      schemaVersion: 1,
      agentId: agentA,
      eventType: "auth_failure",
      occurredAt: occurredInBucket(1_000).toISOString(),
      payload: {},
      tenantId: tenantB,
    });
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.match(parsed.message, /tenant identity/i);

    // Ingest under tenant A principal — row is tenant A; B has nothing.
    const outcome = await telemetry.ingest(tenantA, {
      schemaVersion: 1,
      agentId: agentA,
      eventType: "auth_failure",
      occurredAt: occurredInBucket(1_000),
      payload: { reason: "bad_password" },
    });
    assert.equal(outcome.ok, true);

    const listedA = await createTelemetryRepository(db.app).listRecentByTenant(
      tenantA,
    );
    assert.equal(listedA.length, 1);
    assert.equal(listedA[0].tenantId, tenantA);
    assert.equal(listedA[0].agentId, agentA);

    const listedB = await createTelemetryRepository(db.app).listRecentByTenant(
      tenantB,
    );
    assert.equal(listedB.length, 0);
  });

  it("2. cross-tenant alert isolation is non-oracular", async () => {
    const { telemetry, alertsApi } = wireServices();
    const base = occurredInBucket(0);

    for (let i = 0; i < AUTH_FAILURE_BURST_THRESHOLD; i++) {
      const outcome = await telemetry.ingest(tenantA, {
        schemaVersion: 1,
        agentId: agentA,
        eventType: "auth_failure",
        occurredAt: new Date(base.getTime() + i * 1000),
        payload: {},
      });
      assert.equal(outcome.ok, true);
    }

    const alertsA = await alertsApi.list(tenantA);
    assert.equal(alertsA.length, 1);
    const alertId = alertsA[0].id;

    const alertsB = await alertsApi.list(tenantB);
    assert.equal(alertsB.length, 0);

    const detailB = await alertsApi.getById(tenantB, alertId);
    assert.equal(detailB, undefined);
  });

  it("3. threshold + dedup determinism for rule.auth_failure_burst.v1", async () => {
    const { telemetry, alertsApi } = wireServices();
    const base = occurredInBucket(0);

    for (let i = 0; i < AUTH_FAILURE_BURST_THRESHOLD - 1; i++) {
      const outcome = await telemetry.ingest(tenantA, {
        schemaVersion: 1,
        agentId: agentA,
        eventType: "auth_failure",
        occurredAt: new Date(base.getTime() + i * 1000),
        payload: {},
      });
      assert.equal(outcome.ok, true);
    }
    assert.equal((await alertsApi.list(tenantA)).length, 0);

    const atThreshold = await telemetry.ingest(tenantA, {
      schemaVersion: 1,
      agentId: agentA,
      eventType: "auth_failure",
      occurredAt: new Date(base.getTime() + (AUTH_FAILURE_BURST_THRESHOLD - 1) * 1000),
      payload: {},
    });
    assert.equal(atThreshold.ok, true);

    let alerts = await alertsApi.list(tenantA);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].ruleId, AUTH_FAILURE_BURST_RULE_ID);
    assert.equal(
      alerts[0].evidence.contributingCount,
      AUTH_FAILURE_BURST_THRESHOLD,
    );
    assert.equal(
      alerts[0].evidence.contributingEventIds.length,
      AUTH_FAILURE_BURST_THRESHOLD,
    );

    const afterMore = await telemetry.ingest(tenantA, {
      schemaVersion: 1,
      agentId: agentA,
      eventType: "auth_failure",
      occurredAt: new Date(base.getTime() + AUTH_FAILURE_BURST_THRESHOLD * 1000),
      payload: {},
    });
    assert.equal(afterMore.ok, true);

    alerts = await alertsApi.list(tenantA);
    assert.equal(alerts.length, 1);
    // Evidence is frozen at first create (insert-ignore); count stays at threshold.
    assert.equal(
      alerts[0].evidence.contributingCount,
      AUTH_FAILURE_BURST_THRESHOLD,
    );
  });

  it("4. durable-before-success: forced audit failure rolls back event+alert", async () => {
    const { telemetry, alertsApi } = wireServices({
      beforeAuditInsert: () => {
        throw new Error("forced_audit_write_failure");
      },
    });
    const base = occurredInBucket(0);

    for (let i = 0; i < AUTH_FAILURE_BURST_THRESHOLD - 1; i++) {
      const outcome = await telemetry.ingest(tenantA, {
        schemaVersion: 1,
        agentId: agentA,
        eventType: "auth_failure",
        occurredAt: new Date(base.getTime() + i * 1000),
        payload: {},
      });
      assert.equal(outcome.ok, true);
    }

    await assert.rejects(
      () =>
        telemetry.ingest(tenantA, {
          schemaVersion: 1,
          agentId: agentA,
          eventType: "auth_failure",
          occurredAt: new Date(
            base.getTime() + (AUTH_FAILURE_BURST_THRESHOLD - 1) * 1000,
          ),
          payload: {},
        }),
      /forced_audit_write_failure/,
    );

    const events = await createTelemetryRepository(db.app).listRecentByTenant(
      tenantA,
    );
    // Threshold event rolled back; only THRESHOLD-1 remain.
    assert.equal(events.length, AUTH_FAILURE_BURST_THRESHOLD - 1);
    assert.equal((await alertsApi.list(tenantA)).length, 0);

    const auditCount = await withTenantTransaction(db.app, tenantA, async (trx) => {
      const row = await trx
        .selectFrom("alert_audit_events")
        .select((eb) => eb.fn.countAll<string>().as("c"))
        .executeTakeFirstOrThrow();
      return Number(row.c);
    });
    assert.equal(auditCount, 0);
  });

  it("5. append-only tenant-scoped alert_created audit", async () => {
    const { telemetry, alerts } = wireServices();
    const base = occurredInBucket(0);

    for (let i = 0; i < AUTH_FAILURE_BURST_THRESHOLD; i++) {
      const outcome = await telemetry.ingest(tenantA, {
        schemaVersion: 1,
        agentId: agentA,
        eventType: "auth_failure",
        occurredAt: new Date(base.getTime() + i * 1000),
        payload: {},
      });
      assert.equal(outcome.ok, true);
    }

    const alertsA = await alerts.listAlerts(tenantA);
    assert.equal(alertsA.length, 1);
    const alertId = alertsA[0].id;

    const auditA = await alerts.listAuditForAlert(tenantA, alertId);
    assert.equal(auditA.length, 1);
    assert.equal(auditA[0].eventType, "alert_created");
    assert.equal(auditA[0].tenantId, tenantA);

    const auditB = await alerts.listAuditForAlert(tenantB, alertId);
    assert.equal(auditB.length, 0);

    // depp_app must not UPDATE or DELETE audit rows.
    await assert.rejects(
      () =>
        withTenantTransaction(db.app, tenantA, (trx) =>
          trx
            .updateTable("alert_audit_events")
            .set({ event_type: "tampered" })
            .where("id", "=", auditA[0].id)
            .execute(),
        ),
    );

    await assert.rejects(
      () =>
        withTenantTransaction(db.app, tenantA, (trx) =>
          trx
            .deleteFrom("alert_audit_events")
            .where("id", "=", auditA[0].id)
            .execute(),
        ),
    );

    const still = await alerts.listAuditForAlert(tenantA, alertId);
    assert.equal(still.length, 1);
    assert.equal(still[0].eventType, "alert_created");
  });
});
