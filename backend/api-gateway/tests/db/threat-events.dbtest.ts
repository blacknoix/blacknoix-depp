import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import { createCorrelationFindingsRepository } from "../../src/correlation/repository";
import { withTenantTransaction } from "../../src/db/tenant-context";
import { createDeviceIdentityRepository } from "../../src/threat-events/device-identity-repository";
import { createDevSingleNodeFinalizer } from "../../src/threat-events/finality";
import { createInMemoryGossip } from "../../src/threat-events/gossip";
import { createThreatEventsRepository } from "../../src/threat-events/repository";
import { createThreatEventService } from "../../src/threat-events/service";
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
  tenantA = await seedTenant(db.migrator, `threat-a-${randomUUID().slice(0, 8)}`);
  tenantB = await seedTenant(db.migrator, `threat-b-${randomUUID().slice(0, 8)}`);

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

describe("threat_events persistence and finality", () => {
  it("persists pending then finalizes and materializes a finding", async () => {
    const findings = createCorrelationFindingsRepository(db.app);
    const service = createThreatEventService({
      deviceIdentities: createDeviceIdentityRepository(db.app),
      threatEvents: createThreatEventsRepository(db.app),
      findings,
      finality: createDevSingleNodeFinalizer(),
      gossip: createInMemoryGossip(),
      now: () => new Date("2026-03-01T12:01:00.000Z"),
    });

    const bucket = new Date("2026-03-01T12:00:00.000Z");
    const outcome = await service.submitFromDetection(tenantA, agentA, {
      ruleId: "agent.heartbeat_burst",
      title: "Agent heartbeat burst",
      severity: "medium",
      evidence: { totalInWindow: 30 },
      windowStart: bucket,
      windowEnd: new Date("2026-03-01T12:01:00.000Z"),
      windowBucket: bucket,
    });

    assert.equal(outcome.ok, true);
    if (!outcome.ok || outcome.status !== "created") {
      assert.fail("expected created");
    }

    const threat = await createThreatEventsRepository(db.app).getById(
      tenantA,
      outcome.threatEventId,
    );
    assert.ok(threat);
    assert.equal(threat.finalityState, "finalized");
    assert.equal(threat.findingId, outcome.findingId);

    const finding = await findings.getFindingById(tenantA, outcome.findingId);
    assert.ok(finding);
    assert.equal(finding.ruleId, "agent.heartbeat_burst");
  });

  it("rejects reverse finality transitions", async () => {
    const repo = createThreatEventsRepository(db.app);
    const identities = createDeviceIdentityRepository(db.app);
    const identity = await identities.findByAgentId(tenantA, agentA);
    assert.ok(identity);

    const inserted = await repo.insertPending(tenantA, {
      agentId: agentA,
      deviceIdentityId: identity.id,
      detectionRuleId: "agent.lifecycle_churn",
      title: "Agent lifecycle churn",
      severity: "medium",
      evidence: {},
      windowStart: new Date("2026-03-01T12:00:00.000Z"),
      windowEnd: new Date("2026-03-01T12:10:00.000Z"),
      windowBucket: new Date("2026-03-01T12:00:00.000Z"),
      occurredAt: new Date("2026-03-01T12:10:00.000Z"),
      signature: "sig",
      signedAt: new Date("2026-03-01T12:10:00.000Z"),
      detectionSource: "bridge_correlation",
    });
    assert.equal(inserted.ok, true);
    if (!inserted.ok) {
      return;
    }

    const finalized = await repo.transitionFinality(
      tenantA,
      inserted.event.id,
      "finalized",
      { at: new Date() },
    );
    assert.equal(finalized.ok, true);

    const reverse = await repo.transitionFinality(
      tenantA,
      inserted.event.id,
      "pending",
      { at: new Date() },
    );
    assert.equal(reverse.ok, false);
    if (!reverse.ok) {
      assert.equal(reverse.reason, "invalid_transition");
    }
  });

  it("isolates threat events by tenant", async () => {
    const repo = createThreatEventsRepository(db.app);
    const identityA = await createDeviceIdentityRepository(db.app).findByAgentId(
      tenantA,
      agentA,
    );
    assert.ok(identityA);

    const inserted = await repo.insertPending(tenantA, {
      agentId: agentA,
      deviceIdentityId: identityA.id,
      detectionRuleId: "agent.heartbeat_burst",
      title: "burst",
      severity: "medium",
      evidence: {},
      windowStart: new Date("2026-03-01T12:00:00.000Z"),
      windowEnd: new Date("2026-03-01T12:01:00.000Z"),
      windowBucket: new Date("2026-03-01T12:00:00.000Z"),
      occurredAt: new Date("2026-03-01T12:01:00.000Z"),
      signature: "sig",
      signedAt: new Date("2026-03-01T12:01:00.000Z"),
      detectionSource: "bridge_correlation",
    });
    assert.equal(inserted.ok, true);
    if (!inserted.ok) {
      return;
    }

    const cross = await repo.getById(tenantB, inserted.event.id);
    assert.equal(cross, undefined);
  });

  it("does not materialize a finding when finality rejects", async () => {
    const findings = createCorrelationFindingsRepository(db.app);
    const service = createThreatEventService({
      deviceIdentities: createDeviceIdentityRepository(db.app),
      threatEvents: createThreatEventsRepository(db.app),
      findings,
      finality: {
        async finalize() {
          return {
            ok: false,
            state: "rejected",
            reason: "test reject",
          };
        },
      },
      gossip: createInMemoryGossip(),
      now: () => new Date("2026-03-01T12:01:00.000Z"),
    });

    const bucket = new Date("2026-03-01T13:00:00.000Z");
    const outcome = await service.submitFromDetection(tenantA, agentA, {
      ruleId: "agent.heartbeat_burst",
      title: "Agent heartbeat burst",
      severity: "medium",
      evidence: {},
      windowStart: bucket,
      windowEnd: new Date("2026-03-01T13:01:00.000Z"),
      windowBucket: bucket,
    });

    assert.equal(outcome.ok, false);
    const listed = await findings.listFindings(tenantA, {
      limit: 10,
      offset: 0,
    });
    assert.equal(listed.length, 0);
  });
});
