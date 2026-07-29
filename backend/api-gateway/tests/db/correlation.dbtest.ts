import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { sql } from "kysely";

import { createCorrelationFindingsRepository } from "../../src/correlation/repository";
import { createCorrelationService } from "../../src/correlation/service";
import { createFindingSuppressionsRepository } from "../../src/correlation/suppression-repository";
import { withTenantTransaction } from "../../src/db/tenant-context";
import { createTelemetryRepository } from "../../src/telemetry/repository";
import { createTelemetryService } from "../../src/telemetry/service";
import {
  connectDb,
  resetSchema,
  seedDeviceIdentity,
  seedTenant,
  type DbHandles,
} from "./helpers";

let db: DbHandles;
let tenantA: string;
let tenantB: string;
let agentA: string;
let agentB: string;

function correlationFor(
  now?: () => Date,
): ReturnType<typeof createCorrelationService> {
  return createCorrelationService({
    telemetry: createTelemetryRepository(db.app),
    findings: createCorrelationFindingsRepository(db.app),
    suppressions: createFindingSuppressionsRepository(db.app),
    ...(now ? { now } : {}),
  });
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

  await seedDeviceIdentity(db.migrator, tenantA, agentA);
  await seedDeviceIdentity(db.migrator, tenantB, agentB);
});

function fixedNow(iso: string): () => Date {
  return () => new Date(iso);
}

describe("correlation findings persistence and isolation", () => {
  it("does not expose another tenant's findings", async () => {
    const findings = createCorrelationFindingsRepository(db.app);

    await findings.insertFindingIgnoreDup(tenantB, {
      agentId: agentB,
      ruleId: "agent.lifecycle_churn",
      title: "Agent lifecycle churn",
      severity: "medium",
      evidence: { totalInWindow: 6 },
      windowStart: new Date("2026-03-01T12:00:00.000Z"),
      windowEnd: new Date("2026-03-01T12:10:00.000Z"),
      windowBucket: new Date("2026-03-01T12:00:00.000Z"),
    detectionSource: "legacy_unspecified",
    });

    const seenByA = await findings.listFindings(tenantA, {
      limit: 50,
      offset: 0,
    });
    assert.equal(seenByA.length, 0);

    const seenByB = await findings.listFindings(tenantB, {
      limit: 50,
      offset: 0,
    });
    assert.equal(seenByB.length, 1);
  });

  it("dedups the same rule+bucket on re-insert", async () => {
    const findings = createCorrelationFindingsRepository(db.app);
    const bucket = new Date("2026-03-01T12:00:00.000Z");
    const payload = {
      agentId: agentA,
      ruleId: "agent.lifecycle_churn" as const,
      title: "Agent lifecycle churn",
      severity: "medium" as const,
      evidence: { totalInWindow: 6 },
      windowStart: bucket,
      windowEnd: new Date("2026-03-01T12:10:00.000Z"),
      windowBucket: bucket,
    detectionSource: "legacy_unspecified",
    };

    const first = await findings.insertFindingIgnoreDup(tenantA, payload);
    const second = await findings.insertFindingIgnoreDup(tenantA, payload);

    assert.ok(first);
    assert.equal(second, undefined);

    const listed = await findings.listFindings(tenantA, {
      limit: 50,
      offset: 0,
    });
    assert.equal(listed.length, 1);
  });

  it("fails closed when no tenant context is set", async () => {
    await assert.rejects(
      db.app.selectFrom("correlation_findings").selectAll().execute(),
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        assert.match(message, /app\.current_tenant is not set/i);
        return true;
      },
    );
  });
});

describe("post-ingest correlation evaluation", () => {
  it("does not materialize findings from gateway correlation after bridge deletion", async () => {
    const telemetry = createTelemetryRepository(db.app);
    const findings = createCorrelationFindingsRepository(db.app);
    const nowIso = "2026-03-01T12:10:00.000Z";
    const correlation = correlationFor(fixedNow(nowIso));
    const service = createTelemetryService({ telemetry, correlation });

    const base = new Date("2026-03-01T12:05:00.000Z").getTime();
    const churn = await service.ingestBatch(
      tenantA,
      Array.from({ length: 6 }, (_, i) => ({
        schemaVersion: 1 as const,
        agentId: agentA,
        eventType: (i % 2 === 0 ? "agent.started" : "agent.stopped") as
          | "agent.started"
          | "agent.stopped",
        occurredAt: new Date(base + i * 1000),
        payload: {},
      })),
    );
    assert.equal(churn.ok, true);

    const start = new Date("2026-03-01T12:00:00.000Z").getTime();
    const burst = await service.ingestBatch(
      tenantA,
      Array.from({ length: 30 }, (_, i) => ({
        schemaVersion: 1 as const,
        agentId: agentA,
        eventType: "heartbeat" as const,
        occurredAt: new Date(start + i * 500),
        payload: {},
      })),
    );
    assert.equal(burst.ok, true);

    const listed = await findings.listFindings(tenantA, { limit: 50, offset: 0 });
    assert.equal(listed.length, 0);
  });

  it("keeps tenant isolation for telemetry even when correlation no longer writes findings", async () => {
    const telemetry = createTelemetryRepository(db.app);
    const findings = createCorrelationFindingsRepository(db.app);
    const correlation = correlationFor(fixedNow("2026-03-01T12:00:30.000Z"));
    const service = createTelemetryService({ telemetry, correlation });

    const start = new Date("2026-03-01T12:00:00.000Z").getTime();
    await service.ingestBatch(
      tenantB,
      Array.from({ length: 30 }, (_, i) => ({
        schemaVersion: 1 as const,
        agentId: agentB,
        eventType: "heartbeat" as const,
        occurredAt: new Date(start + i * 500),
        payload: {},
      })),
    );

    const seenByA = await findings.listFindings(tenantA, {
      limit: 50,
      offset: 0,
    });
    assert.equal(seenByA.length, 0);

    const seenByB = await findings.listFindings(tenantB, {
      limit: 50,
      offset: 0,
    });
    assert.equal(seenByB.length, 0);

    const eventsB = await telemetry.listRecentByTenant(tenantB);
    assert.ok(eventsB.length >= 30);
    const eventsA = await telemetry.listRecentByTenant(tenantA);
    assert.equal(eventsA.length, 0);
  });

  it("keeps ingest successful when correlation throws", async () => {
    const telemetry = createTelemetryRepository(db.app);
    const service = createTelemetryService({
      telemetry,
      correlation: {
        evaluateAfterIngest: async () => {
          throw new Error("boom");
        },
        evaluateSilence: async () => ({
          evaluated: 0,
          created: 0,
          suppressed: 0,
        }),
        updateStatus: async () => ({ ok: false, reason: "not_found" }),
        patchFinding: async () => ({ ok: false, reason: "not_found" }),
        createSuppression: async () => ({ ok: false, reason: "conflict" }),
        clearSuppression: async () => ({ ok: false, reason: "not_found" }),
        listSuppressions: async () => [],
        list: async () => [],
        dashboard: async () => ({
          generatedAt: new Date(),
          windowHours: 24,
          countsByStatus: { open: 0, acknowledged: 0, resolved: 0 },
          countsByRuleId: {
            "agent.lifecycle_churn": 0,
            "agent.heartbeat_burst": 0,
            "agent.heartbeat_silence": 0,
          },
          recentCreatedCount: 0,
          recentChangedCount: 0,
          activeSuppressionCount: 0,
        }),
        attention: async () => ({
          generatedAt: new Date(),
          since: new Date(),
          maxLookbackHours: 24,
          openCount: 0,
          activeSuppressionCount: 0,
          items: [],
          truncated: false,
        }),
      },
    });

    const outcome = await service.ingest(tenantA, {
      schemaVersion: 1,
      agentId: agentA,
      eventType: "heartbeat",
      occurredAt: new Date(),
      payload: {},
    });
    assert.equal(outcome.ok, true);

    const listed = await telemetry.listRecentByTenant(tenantA);
    assert.equal(listed.length, 1);
  });
});

describe("heartbeat silence evaluation", () => {
  it("evaluates silence but never materializes bridge findings after deletion", async () => {
    const telemetry = createTelemetryRepository(db.app);
    const findingsRepo = createCorrelationFindingsRepository(db.app);
    const nowIso = "2026-03-01T12:10:00.000Z";
    const correlation = correlationFor(fixedNow(nowIso));

    // No heartbeat yet → never-heartbeated → skipped.
    let result = await correlation.evaluateSilence(tenantA, {
      agentId: agentA,
    });
    assert.deepEqual(result, { evaluated: 1, created: 0, suppressed: 0 });

    // Stale heartbeat would formerly create a finding; write path is deleted.
    await telemetry.insertEvent(tenantA, {
      agentId: agentA,
      schemaVersion: 1,
      eventType: "heartbeat",
      occurredAt: new Date("2026-03-01T12:04:00.000Z"),
      payload: {},
    });

    result = await correlation.evaluateSilence(tenantA, { agentId: agentA });
    assert.equal(result.evaluated, 1);
    assert.equal(result.created, 0);
    assert.equal(result.suppressed, 1);

    const listed = await findingsRepo.listFindings(tenantA, {
      ruleId: "agent.heartbeat_silence",
      limit: 50,
      offset: 0,
    });
    assert.equal(listed.length, 0);
  });

  it("does not fire when a recent heartbeat exists", async () => {
    const telemetry = createTelemetryRepository(db.app);
    const findingsRepo = createCorrelationFindingsRepository(db.app);
    const correlation = correlationFor(fixedNow("2026-03-01T12:10:00.000Z"));

    await telemetry.insertEvent(tenantA, {
      agentId: agentA,
      schemaVersion: 1,
      eventType: "heartbeat",
      occurredAt: new Date("2026-03-01T12:09:00.000Z"),
      payload: {},
    });

    const result = await correlation.evaluateSilence(tenantA, {
      agentId: agentA,
    });
    assert.deepEqual(result, { evaluated: 1, created: 0, suppressed: 0 });

    const listed = await findingsRepo.listFindings(tenantA, {
      ruleId: "agent.heartbeat_silence",
      limit: 50,
      offset: 0,
    });
    assert.equal(listed.length, 0);
  });

  it("scans stale agents per tenant without writing findings", async () => {
    const telemetry = createTelemetryRepository(db.app);
    const findingsRepo = createCorrelationFindingsRepository(db.app);
    const correlation = correlationFor(fixedNow("2026-03-01T12:10:00.000Z"));

    await telemetry.insertEvent(tenantB, {
      agentId: agentB,
      schemaVersion: 1,
      eventType: "heartbeat",
      occurredAt: new Date("2026-03-01T12:00:00.000Z"),
      payload: {},
    });

    const resultA = await correlation.evaluateSilence(tenantA);
    assert.equal(resultA.created, 0);

    const resultB = await correlation.evaluateSilence(tenantB);
    assert.equal(resultB.created, 0);
    assert.equal(resultB.suppressed, 1);

    const seenByA = await findingsRepo.listFindings(tenantA, {
      limit: 50,
      offset: 0,
    });
    assert.equal(seenByA.length, 0);

    const seenByB = await findingsRepo.listFindings(tenantB, {
      ruleId: "agent.heartbeat_silence",
      limit: 50,
      offset: 0,
    });
    assert.equal(seenByB.length, 0);
  });
});

describe("findings lifecycle triage", () => {
  async function seedOpenFinding(): Promise<string> {
    const findingsRepo = createCorrelationFindingsRepository(db.app);
    const id = await findingsRepo.insertFindingIgnoreDup(tenantA, {
      agentId: agentA,
      ruleId: "agent.lifecycle_churn",
      title: "Agent lifecycle churn",
      severity: "medium",
      evidence: { totalInWindow: 6 },
      windowStart: new Date("2026-03-01T12:00:00.000Z"),
      windowEnd: new Date("2026-03-01T12:10:00.000Z"),
      windowBucket: new Date("2026-03-01T12:00:00.000Z"),
    detectionSource: "legacy_unspecified",
    });
    assert.ok(id);
    return id!;
  }

  it("inserts findings as open and transitions with audit stamps", async () => {
    const findingsRepo = createCorrelationFindingsRepository(db.app);
    const changedAt = new Date("2026-03-01T15:00:00.000Z");
    const correlation = correlationFor(() => changedAt);

    const id = await seedOpenFinding();
    const before = await findingsRepo.getFindingById(tenantA, id);
    assert.ok(before);
    assert.equal(before.status, "open");
    assert.equal(before.statusChangedAt, null);

    const ack = await correlation.updateStatus(tenantA, id, "acknowledged", {});
    assert.equal(ack.ok, true);
    if (!ack.ok) return;
    assert.equal(ack.finding.status, "acknowledged");
    assert.equal(ack.finding.statusChangedAt?.toISOString(), changedAt.toISOString());
    assert.equal(ack.finding.statusChangedByUserId, null);

    const bad = await correlation.updateStatus(
      tenantA,
      id,
      "acknowledged",
      {},
    );
    // same status → noop success
    assert.equal(bad.ok, true);

    // Move to resolved then forbid resolved → acknowledged
    const resolved = await correlation.updateStatus(tenantA, id, "resolved", {});
    assert.equal(resolved.ok, true);

    const forbidden = await correlation.updateStatus(
      tenantA,
      id,
      "acknowledged",
      {},
    );
    assert.equal(forbidden.ok, false);
    if (forbidden.ok) return;
    assert.equal(forbidden.reason, "invalid_transition");
  });

  it("supports self-claim ownership and current operator note", async () => {
    const userId = "22222222-2222-4222-8222-222222222222";
    const otherUser = "33333333-3333-4333-8333-333333333333";
    const changedAt = new Date("2026-03-01T16:00:00.000Z");
    const correlation = correlationFor(() => changedAt);
    const id = await seedOpenFinding();

    const noIdentity = await correlation.patchFinding(
      tenantA,
      id,
      { claimOwner: true },
      {},
    );
    assert.equal(noIdentity.ok, false);
    if (noIdentity.ok) return;
    assert.equal(noIdentity.reason, "rejected");

    const assignOther = await correlation.patchFinding(
      tenantA,
      id,
      { ownerUserId: otherUser },
      { userId },
    );
    assert.equal(assignOther.ok, false);
    if (assignOther.ok) return;
    assert.equal(assignOther.reason, "rejected");

    const claim = await correlation.patchFinding(
      tenantA,
      id,
      { claimOwner: true },
      { userId },
    );
    assert.equal(claim.ok, true);
    if (!claim.ok) return;
    assert.equal(claim.finding.ownerUserId, userId);
    assert.equal(
      claim.finding.ownerChangedAt?.toISOString(),
      changedAt.toISOString(),
    );
    assert.equal(claim.finding.ownerChangedByUserId, userId);

    const note = await correlation.patchFinding(
      tenantA,
      id,
      { operatorNote: "  Checking host reboot window  " },
      { userId },
    );
    assert.equal(note.ok, true);
    if (!note.ok) return;
    assert.equal(note.finding.operatorNote, "Checking host reboot window");
    assert.equal(note.finding.operatorNoteUpdatedByUserId, userId);

    const clear = await correlation.patchFinding(
      tenantA,
      id,
      { ownerUserId: null, operatorNote: null },
      { userId },
    );
    assert.equal(clear.ok, true);
    if (!clear.ok) return;
    assert.equal(clear.finding.ownerUserId, null);
    assert.equal(clear.finding.operatorNote, null);
  });

  it("does not update another tenant's finding", async () => {
    const findingsRepo = createCorrelationFindingsRepository(db.app);
    const correlation = correlationFor();

    const id = await findingsRepo.insertFindingIgnoreDup(tenantB, {
      agentId: agentB,
      ruleId: "agent.heartbeat_burst",
      title: "Agent heartbeat burst",
      severity: "medium",
      evidence: {},
      windowStart: new Date("2026-03-01T12:00:00.000Z"),
      windowEnd: new Date("2026-03-01T12:01:00.000Z"),
      windowBucket: new Date("2026-03-01T12:00:00.000Z"),
    detectionSource: "legacy_unspecified",
    });
    assert.ok(id);

    const outcome = await correlation.updateStatus(
      tenantA,
      id!,
      "acknowledged",
      {},
    );
    assert.deepEqual(outcome, { ok: false, reason: "not_found" });

    const stillOpen = await findingsRepo.getFindingById(tenantB, id!);
    assert.equal(stillOpen?.status, "open");
  });

  it("returns not_found for an unknown finding id", async () => {
    const correlation = correlationFor();

    const outcome = await correlation.updateStatus(
      tenantA,
      "ffffffff-ffff-4fff-8fff-ffffffffffff",
      "acknowledged",
      {},
    );
    assert.deepEqual(outcome, { ok: false, reason: "not_found" });
  });
});

describe("finding suppressions (snooze)", () => {
  it("short-circuits silence evaluation while a rule snooze is active", async () => {
    const findingsRepo = createCorrelationFindingsRepository(db.app);
    const suppressions = createFindingSuppressionsRepository(db.app);
    const nowIso = "2026-03-01T12:10:00.000Z";
    const correlation = correlationFor(fixedNow(nowIso));
    const telemetry = createTelemetryRepository(db.app);

    await telemetry.insertEvent(tenantA, {
      agentId: agentA,
      schemaVersion: 1,
      eventType: "heartbeat",
      occurredAt: new Date("2026-03-01T12:00:00.000Z"),
      payload: {},
    });

    const created = await correlation.createSuppression(tenantA, {
      ruleId: "agent.heartbeat_silence",
      startsAt: new Date("2026-03-01T12:00:00.000Z"),
      endsAt: new Date("2026-03-01T13:00:00.000Z"),
      createdByUserId: null,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const during = await correlation.evaluateSilence(tenantA, {
      agentId: agentA,
    });
    // Snooze prevents the deleted write-path noise counter (suppressed).
    assert.deepEqual(during, { evaluated: 1, created: 0, suppressed: 0 });
    assert.equal(
      (await findingsRepo.listFindings(tenantA, { limit: 50, offset: 0 }))
        .length,
      0,
    );

    const cleared = await correlation.clearSuppression(
      tenantA,
      created.suppression.id,
      {},
    );
    assert.equal(cleared.ok, true);

    const after = await correlation.evaluateSilence(tenantA, {
      agentId: agentA,
    });
    // Bridge write path deleted: evaluation may count as suppressed, never creates.
    assert.equal(after.created, 0);
    assert.equal(after.suppressed, 1);
    assert.equal(
      (await findingsRepo.listFindings(tenantA, { limit: 50, offset: 0 }))
        .length,
      0,
    );

    // Expiry: uncleared but ends_at in the past is not active.
    await suppressions.insertSuppression(tenantA, {
      ruleId: "agent.lifecycle_churn",
      startsAt: new Date("2026-03-01T12:00:00.000Z"),
      endsAt: new Date("2026-03-01T13:00:00.000Z"),
      createdByUserId: null,
    });
    assert.equal(
      await suppressions.isRuleSuppressedAt(
        tenantA,
        "agent.lifecycle_churn",
        new Date("2026-03-01T14:00:00.000Z"),
      ),
      false,
    );
  });

  it("rejects a second uncleared snooze for the same rule and isolates tenants", async () => {
    const correlation = correlationFor(fixedNow("2026-03-01T12:00:00.000Z"));

    const first = await correlation.createSuppression(tenantA, {
      ruleId: "agent.heartbeat_burst",
      startsAt: new Date("2026-03-01T12:00:00.000Z"),
      endsAt: new Date("2026-03-01T13:00:00.000Z"),
      createdByUserId: null,
    });
    assert.equal(first.ok, true);

    const conflict = await correlation.createSuppression(tenantA, {
      ruleId: "agent.heartbeat_burst",
      startsAt: new Date("2026-03-01T12:00:00.000Z"),
      endsAt: new Date("2026-03-01T14:00:00.000Z"),
      createdByUserId: null,
    });
    assert.deepEqual(conflict, { ok: false, reason: "conflict" });

    const other = await correlation.createSuppression(tenantB, {
      ruleId: "agent.heartbeat_burst",
      startsAt: new Date("2026-03-01T12:00:00.000Z"),
      endsAt: new Date("2026-03-01T13:00:00.000Z"),
      createdByUserId: null,
    });
    assert.equal(other.ok, true);

    const listedA = await correlation.listSuppressions(tenantA);
    assert.equal(listedA.length, 1);
    assert.equal(listedA[0].ruleId, "agent.heartbeat_burst");
  });
});

describe("findings dashboard read-model", () => {
  it("returns zero-filled empty state", async () => {
    const correlation = correlationFor(fixedNow("2026-03-01T12:00:00.000Z"));
    const dashboard = await correlation.dashboard(tenantA);

    assert.deepEqual(dashboard.countsByStatus, {
      open: 0,
      acknowledged: 0,
      resolved: 0,
    });
    assert.deepEqual(dashboard.countsByRuleId, {
      "agent.lifecycle_churn": 0,
      "agent.heartbeat_burst": 0,
      "agent.heartbeat_silence": 0,
    });
    assert.equal(dashboard.recentCreatedCount, 0);
    assert.equal(dashboard.recentChangedCount, 0);
    assert.equal(dashboard.activeSuppressionCount, 0);
    assert.equal(dashboard.windowHours, 24);
  });

  it("aggregates status/rule/recent windows and isolates tenants", async () => {
    const findings = createCorrelationFindingsRepository(db.app);
    const nowIso = "2026-03-01T12:00:00.000Z";
    const correlation = correlationFor(fixedNow(nowIso));

    await findings.insertFindingIgnoreDup(tenantA, {
      agentId: agentA,
      ruleId: "agent.lifecycle_churn",
      title: "Agent lifecycle churn",
      severity: "medium",
      evidence: {},
      windowStart: new Date("2026-03-01T11:50:00.000Z"),
      windowEnd: new Date("2026-03-01T12:00:00.000Z"),
      windowBucket: new Date("2026-03-01T11:50:00.000Z"),
    detectionSource: "legacy_unspecified",
    });
    await findings.insertFindingIgnoreDup(tenantA, {
      agentId: agentA,
      ruleId: "agent.heartbeat_burst",
      title: "Agent heartbeat burst",
      severity: "medium",
      evidence: {},
      windowStart: new Date("2026-03-01T11:59:00.000Z"),
      windowEnd: new Date("2026-03-01T12:00:00.000Z"),
      windowBucket: new Date("2026-03-01T11:59:00.000Z"),
    detectionSource: "legacy_unspecified",
    });
    await findings.insertFindingIgnoreDup(tenantB, {
      agentId: agentB,
      ruleId: "agent.lifecycle_churn",
      title: "Agent lifecycle churn",
      severity: "medium",
      evidence: {},
      windowStart: new Date("2026-03-01T11:50:00.000Z"),
      windowEnd: new Date("2026-03-01T12:00:00.000Z"),
      windowBucket: new Date("2026-03-01T11:50:00.000Z"),
    detectionSource: "legacy_unspecified",
    });

    const listed = await findings.listFindings(tenantA, {
      limit: 50,
      offset: 0,
    });
    const openId = listed.find((f) => f.ruleId === "agent.lifecycle_churn")?.id;
    assert.ok(openId);
    await correlation.updateStatus(tenantA, openId, "acknowledged", {});

    await correlation.createSuppression(tenantA, {
      ruleId: "agent.heartbeat_silence",
      startsAt: new Date("2026-03-01T11:00:00.000Z"),
      endsAt: new Date("2026-03-01T13:00:00.000Z"),
      createdByUserId: null,
    });

    const dashboard = await correlation.dashboard(tenantA);
    assert.deepEqual(dashboard.countsByStatus, {
      open: 1,
      acknowledged: 1,
      resolved: 0,
    });
    assert.deepEqual(dashboard.countsByRuleId, {
      "agent.lifecycle_churn": 1,
      "agent.heartbeat_burst": 1,
      "agent.heartbeat_silence": 0,
    });
    assert.equal(dashboard.recentCreatedCount, 2);
    assert.equal(dashboard.recentChangedCount, 1);
    assert.equal(dashboard.activeSuppressionCount, 1);

    const other = await correlation.dashboard(tenantB);
    assert.deepEqual(other.countsByStatus, {
      open: 1,
      acknowledged: 0,
      resolved: 0,
    });
    assert.equal(other.countsByRuleId["agent.lifecycle_churn"], 1);
    assert.equal(other.countsByRuleId["agent.heartbeat_burst"], 0);
    assert.equal(other.activeSuppressionCount, 0);
  });

  it("excludes findings older than the fixed 24h recent window", async () => {
    const findings = createCorrelationFindingsRepository(db.app);
    const correlation = correlationFor(fixedNow("2026-03-03T12:00:00.000Z"));

    await findings.insertFindingIgnoreDup(tenantA, {
      agentId: agentA,
      ruleId: "agent.heartbeat_silence",
      title: "Agent heartbeat silence",
      severity: "medium",
      evidence: {},
      windowStart: new Date("2026-03-01T11:55:00.000Z"),
      windowEnd: new Date("2026-03-01T12:00:00.000Z"),
      windowBucket: new Date("2026-03-01T11:55:00.000Z"),
    detectionSource: "legacy_unspecified",
    });

    // Age created_at under tenant scope (FORCE RLS applies even to the owner).
    await withTenantTransaction(db.app, tenantA, async (trx) => {
      await sql`
        update correlation_findings
        set created_at = ${new Date("2026-03-01T12:00:00.000Z")}
      `.execute(trx);
    });

    const dashboard = await correlation.dashboard(tenantA);
    assert.equal(dashboard.countsByStatus.open, 1);
    assert.equal(dashboard.recentCreatedCount, 0);
    assert.equal(dashboard.recentChangedCount, 0);
  });
});

describe("findings attention digest (real database)", () => {
  it("lists created and status-changed items and isolates tenants", async () => {
    const findings = createCorrelationFindingsRepository(db.app);
    const correlation = correlationFor(fixedNow("2026-03-01T12:00:00.000Z"));

    await findings.insertFindingIgnoreDup(tenantA, {
      agentId: agentA,
      ruleId: "agent.lifecycle_churn",
      title: "Agent lifecycle churn",
      severity: "medium",
      evidence: {},
      windowStart: new Date("2026-03-01T11:50:00.000Z"),
      windowEnd: new Date("2026-03-01T12:00:00.000Z"),
      windowBucket: new Date("2026-03-01T11:50:00.000Z"),
    detectionSource: "legacy_unspecified",
    });
    await findings.insertFindingIgnoreDup(tenantB, {
      agentId: agentB,
      ruleId: "agent.lifecycle_churn",
      title: "Agent lifecycle churn",
      severity: "medium",
      evidence: {},
      windowStart: new Date("2026-03-01T11:50:00.000Z"),
      windowEnd: new Date("2026-03-01T12:00:00.000Z"),
      windowBucket: new Date("2026-03-01T11:50:00.000Z"),
    detectionSource: "legacy_unspecified",
    });

    const listed = await findings.listFindings(tenantA, {
      limit: 10,
      offset: 0,
    });
    assert.equal(listed.length, 1);
    await correlation.updateStatus(tenantA, listed[0].id, "acknowledged", {});

    const digest = await correlation.attention(
      tenantA,
      new Date("2026-03-01T00:00:00.000Z"),
    );
    assert.equal(digest.openCount, 0);
    assert.ok(digest.items.some((i) => i.kind === "finding.created"));
    assert.ok(digest.items.some((i) => i.kind === "finding.status_changed"));
    assert.ok(
      digest.items.every((i) => i.findingId === listed[0].id),
    );

    const other = await correlation.attention(
      tenantB,
      new Date("2026-03-01T00:00:00.000Z"),
    );
    assert.equal(other.openCount, 1);
    assert.ok(other.items.every((i) => i.kind === "finding.created"));
    assert.ok(other.items.every((i) => i.findingId !== listed[0].id));
  });
});
