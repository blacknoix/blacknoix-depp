/**
 * ADR-0005 bridge-removal: coverage-gated disablement.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveCorrelationBridgeCoverageAutoDisable,
  resolveCorrelationBridgeCoverageMinFindings,
  resolveCorrelationBridgeCoverageSoakHours,
  resolveCorrelationBridgeCoverageThreshold,
  resolveCorrelationBridgeForceEnabledTenants,
} from "../../src/config/env";
import type {
  CorrelationFindingRow,
  CorrelationFindingsRepository,
} from "../../src/correlation/repository";
import {
  evaluateBridgeCoverageEligibility,
  signedCoverageRatio,
} from "../../src/threat-events/bridge-coverage";
import { createDevSingleNodeFinalizer } from "../../src/threat-events/finality";
import { createInMemoryGossip } from "../../src/threat-events/gossip";
import {
  DETECTION_SOURCE_AGENT_SIGNED,
  DETECTION_SOURCE_BRIDGE,
} from "../../src/threat-events/provenance";
import type {
  ThreatEventInsert,
  ThreatEventRow,
  ThreatEventsRepository,
} from "../../src/threat-events/repository";
import { createThreatEventService } from "../../src/threat-events/service";
import type { DeviceIdentityRepository } from "../../src/threat-events/device-identity-repository";
import type { FinalityState } from "../../src/threat-events/envelope";
import {
  generateEd25519KeyPairForTests,
  signThreatEventEnvelope,
} from "../../src/threat-events/signature";

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const agentId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const deviceId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const bucket = new Date("2026-03-01T12:00:00.000Z");
const SOAK_MS = 24 * 60 * 60 * 1000;

function candidate() {
  return {
    ruleId: "agent.heartbeat_burst" as const,
    title: "Agent heartbeat burst",
    severity: "medium" as const,
    evidence: {},
    windowStart: bucket,
    windowEnd: new Date("2026-03-01T12:01:00.000Z"),
    windowBucket: bucket,
  };
}

function rowFromInsert(
  id: string,
  input: ThreatEventInsert,
  state: FinalityState = "pending",
): ThreatEventRow {
  return {
    id,
    tenantId,
    agentId: input.agentId,
    deviceIdentityId: input.deviceIdentityId,
    detectionRuleId: input.detectionRuleId,
    title: input.title,
    severity: input.severity,
    evidence: input.evidence,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    windowBucket: input.windowBucket,
    occurredAt: input.occurredAt,
    signature: input.signature,
    signedAt: input.signedAt,
    finalityState: state,
    finalityReason: null,
    finalizedAt: null,
    findingId: null,
    createdAt: new Date("2026-03-01T12:01:00.000Z"),
    detectionSource: input.detectionSource,
  };
}

function activeIdentity(publicKeyEd25519 = "pk"): DeviceIdentityRepository {
  return {
    async findByAgentId() {
      return {
        id: deviceId,
        tenantId,
        agentId,
        publicKeyEd25519,
        deviceCertPem: null,
        status: "active",
        createdAt: new Date(),
        revokedAt: null,
      };
    },
    async findById() {
      return {
        id: deviceId,
        tenantId,
        agentId,
        publicKeyEd25519,
        deviceCertPem: null,
        status: "active",
        createdAt: new Date(),
        revokedAt: null,
      };
    },
    async insert() {
      throw new Error("not used");
    },
    async revoke() {
      return undefined;
    },
  };
}

function memoryThreatEvents(): ThreatEventsRepository {
  const byId = new Map<string, ThreatEventRow>();
  const pathKey = (input: ThreatEventInsert) =>
    `${input.agentId}|${input.detectionRuleId}|${input.windowBucket.toISOString()}|${input.detectionSource}`;
  const byPath = new Map<string, string>();
  let seq = 0;

  return {
    async insertPending(_tid, input) {
      const key = pathKey(input);
      if (byPath.has(key)) {
        return { ok: false, reason: "duplicate" };
      }
      seq += 1;
      const id = `eeeeeeee-eeee-4eee-8eee-${String(seq).padStart(12, "0")}`;
      const event = rowFromInsert(id, input);
      byId.set(id, event);
      byPath.set(key, id);
      return { ok: true, event };
    },
    async getById(_tid, id) {
      return byId.get(id);
    },
    async transitionFinality(_tid, id, to, options) {
      const current = byId.get(id);
      if (!current) {
        return { ok: false, reason: "not_found" };
      }
      const next = {
        ...current,
        finalityState: to,
        finalityReason: options.reason ?? null,
        finalizedAt: to === "finalized" ? options.at : null,
        findingId: options.findingId ?? current.findingId,
      };
      byId.set(id, next);
      return { ok: true, event: next };
    },
  };
}

function memoryFindings(seed: CorrelationFindingRow[] = []): {
  repo: CorrelationFindingsRepository;
  rows: CorrelationFindingRow[];
} {
  const rows = [...seed];
  let seq = rows.length;

  const repo: CorrelationFindingsRepository = {
    async insertFindingIgnoreDup(tid, finding) {
      const existing = rows.find(
        (r) =>
          r.tenantId === tid &&
          r.agentId === finding.agentId &&
          r.ruleId === finding.ruleId &&
          r.windowBucket.getTime() === finding.windowBucket.getTime(),
      );
      if (existing) {
        return undefined;
      }
      seq += 1;
      const id = `ffffffff-ffff-4fff-8fff-${String(seq).padStart(12, "0")}`;
      rows.push({
        id,
        tenantId: tid,
        agentId: finding.agentId,
        ruleId: finding.ruleId,
        title: finding.title,
        severity: finding.severity,
        evidence: finding.evidence,
        windowStart: finding.windowStart,
        windowEnd: finding.windowEnd,
        windowBucket: finding.windowBucket,
        createdAt: new Date(),
        status: "open",
        statusChangedAt: null,
        statusChangedByUserId: null,
        ownerUserId: null,
        ownerChangedAt: null,
        ownerChangedByUserId: null,
        operatorNote: null,
        operatorNoteUpdatedAt: null,
        operatorNoteUpdatedByUserId: null,
        detectionSource: finding.detectionSource,
      });
      return id;
    },
    async findFindingByDedupKey(tid, key) {
      return rows.find(
        (r) =>
          r.tenantId === tid &&
          r.agentId === key.agentId &&
          r.ruleId === key.ruleId &&
          r.windowBucket.getTime() === key.windowBucket.getTime(),
      );
    },
    async upgradeDetectionSourceMonotonic(tid, input) {
      if (
        input.from !== DETECTION_SOURCE_BRIDGE ||
        input.to !== DETECTION_SOURCE_AGENT_SIGNED
      ) {
        return undefined;
      }
      const row = rows.find(
        (r) =>
          r.tenantId === tid &&
          r.agentId === input.agentId &&
          r.ruleId === input.ruleId &&
          r.windowBucket.getTime() === input.windowBucket.getTime() &&
          r.detectionSource === input.from,
      );
      if (!row) {
        return undefined;
      }
      row.detectionSource = input.to;
      return row.id;
    },
    async getBridgeCoverageCounts(tid, windowStart, windowEnd) {
      const inWindow = rows.filter(
        (r) =>
          r.tenantId === tid &&
          r.createdAt.getTime() >= windowStart.getTime() &&
          r.createdAt.getTime() <= windowEnd.getTime() &&
          (r.detectionSource === DETECTION_SOURCE_AGENT_SIGNED ||
            r.detectionSource === DETECTION_SOURCE_BRIDGE),
      );
      const signed = inWindow.filter(
        (r) => r.detectionSource === DETECTION_SOURCE_AGENT_SIGNED,
      );
      const bridge = inWindow.filter(
        (r) => r.detectionSource === DETECTION_SOURCE_BRIDGE,
      );
      const firstSigned = rows
        .filter(
          (r) =>
            r.tenantId === tid &&
            r.detectionSource === DETECTION_SOURCE_AGENT_SIGNED,
        )
        .map((r) => r.createdAt)
        .sort((a, b) => a.getTime() - b.getTime())[0];
      const oldestInWindow = inWindow
        .map((r) => r.createdAt)
        .sort((a, b) => a.getTime() - b.getTime())[0];
      return {
        signedCount: signed.length,
        bridgeCount: bridge.length,
        firstSignedAt: firstSigned ?? null,
        oldestInWindowAt: oldestInWindow ?? null,
      };
    },
    async listFindings(tid) {
      return rows.filter((r) => r.tenantId === tid);
    },
    async getFindingById(tid, id) {
      return rows.find((r) => r.tenantId === tid && r.id === id);
    },
    async updateFindingStatus() {
      return undefined;
    },
    async updateFindingIntent() {
      return undefined;
    },
    async getDashboardRawCounts() {
      throw new Error("not used");
    },
    async getAttentionRawSources() {
      throw new Error("not used");
    },
  };

  return { repo, rows };
}

function findingRow(partial: {
  id: string;
  detectionSource: string;
  createdAt: Date;
  windowBucket?: Date;
}): CorrelationFindingRow {
  return {
    id: partial.id,
    tenantId,
    agentId,
    ruleId: "agent.heartbeat_burst",
    title: "t",
    severity: "medium",
    evidence: {},
    windowStart: partial.windowBucket ?? bucket,
    windowEnd: partial.windowBucket ?? bucket,
    windowBucket: partial.windowBucket ?? bucket,
    createdAt: partial.createdAt,
    status: "open",
    statusChangedAt: null,
    statusChangedByUserId: null,
    ownerUserId: null,
    ownerChangedAt: null,
    ownerChangedByUserId: null,
    operatorNote: null,
    operatorNoteUpdatedAt: null,
    operatorNoteUpdatedByUserId: null,
    detectionSource: partial.detectionSource,
  };
}

function signedEnvelope(
  privateKey: ReturnType<typeof generateEd25519KeyPairForTests>["privateKey"],
  windowBucket = bucket,
) {
  const unsigned = {
    kind: "THREATEVENT" as const,
    tenantId,
    agentId,
    deviceIdentityId: deviceId,
    detectionRuleId: "agent.heartbeat_burst" as const,
    title: "Agent heartbeat burst",
    severity: "medium" as const,
    evidence: {},
    windowStart: windowBucket,
    windowEnd: windowBucket,
    windowBucket,
    occurredAt: windowBucket,
    signedAt: windowBucket,
  };
  return {
    ...unsigned,
    signature: signThreatEventEnvelope(privateKey, unsigned),
  };
}

describe("ADR-0005 bridge-removal coverage evaluation", () => {
  it("1. coverage is computed from signed-vs-bridge finding counts", () => {
    assert.equal(signedCoverageRatio(9, 1), 0.9);
    assert.equal(signedCoverageRatio(0, 0), 0);

    const at = new Date("2026-07-01T12:00:00.000Z");
    const evaluation = evaluateBridgeCoverageEligibility(
      tenantId,
      {
        signedCount: 9,
        bridgeCount: 1,
        firstSignedAt: new Date(at.getTime() - SOAK_MS),
        oldestInWindowAt: new Date(at.getTime() - SOAK_MS),
      },
      { threshold: 0.9, soakMs: SOAK_MS, minFindings: 5 },
      at,
    );
    assert.equal(evaluation.signedRatio, 0.9);
    assert.equal(evaluation.eligible, true);
    assert.deepEqual(evaluation.reasons, []);
  });

  it("2. tenant reaches eligibility only after the soak window", () => {
    const at = new Date("2026-07-01T12:00:00.000Z");
    const beforeSoak = evaluateBridgeCoverageEligibility(
      tenantId,
      {
        signedCount: 10,
        bridgeCount: 0,
        firstSignedAt: new Date(at.getTime() - SOAK_MS + 60_000),
        oldestInWindowAt: new Date(at.getTime() - 60_000),
      },
      { threshold: 0.95, soakMs: SOAK_MS, minFindings: 5 },
      at,
    );
    assert.equal(beforeSoak.eligible, false);
    assert.equal(beforeSoak.reasons.includes("soak_not_met"), true);

    const afterSoak = evaluateBridgeCoverageEligibility(
      tenantId,
      {
        signedCount: 10,
        bridgeCount: 0,
        firstSignedAt: new Date(at.getTime() - SOAK_MS),
        oldestInWindowAt: new Date(at.getTime() - SOAK_MS),
      },
      { threshold: 0.95, soakMs: SOAK_MS, minFindings: 5 },
      at,
    );
    assert.equal(afterSoak.eligible, true);
  });

  it("3. bridge stays enabled below threshold or before soak", async () => {
    const at = new Date("2026-07-01T12:00:00.000Z");
    const findings = memoryFindings([
      findingRow({
        id: "1",
        detectionSource: DETECTION_SOURCE_AGENT_SIGNED,
        createdAt: new Date(at.getTime() - 60_000),
        windowBucket: new Date("2026-03-01T10:00:00.000Z"),
      }),
      findingRow({
        id: "2",
        detectionSource: DETECTION_SOURCE_BRIDGE,
        createdAt: new Date(at.getTime() - 30_000),
        windowBucket: new Date("2026-03-01T11:00:00.000Z"),
      }),
    ]);

    const service = createThreatEventService({
      deviceIdentities: activeIdentity(),
      threatEvents: memoryThreatEvents(),
      findings: findings.repo,
      finality: createDevSingleNodeFinalizer(),
      gossip: createInMemoryGossip(),
      now: () => at,
      correlationBridgeCoverageAutoDisable: true,
      correlationBridgeCoveragePolicy: {
        threshold: 0.95,
        soakMs: SOAK_MS,
        minFindings: 1,
      },
    });

    const outcome = await service.submitFromDetection(
      tenantId,
      agentId,
      candidate(),
    );
    assert.equal(outcome.ok, true);
    if (!outcome.ok || outcome.status !== "created") {
      assert.fail(`expected bridge still enabled, got ${JSON.stringify(outcome)}`);
    }
  });

  it("4. bridge disables for an eligible tenant", async () => {
    const at = new Date("2026-07-01T12:00:00.000Z");
    const findings = memoryFindings(
      Array.from({ length: 5 }, (_, i) =>
        findingRow({
          id: String(i + 1),
          detectionSource: DETECTION_SOURCE_AGENT_SIGNED,
          createdAt: new Date(at.getTime() - SOAK_MS + i * 1000),
          windowBucket: new Date(bucket.getTime() + i * 60_000),
        }),
      ),
    );

    const service = createThreatEventService({
      deviceIdentities: activeIdentity(),
      threatEvents: memoryThreatEvents(),
      findings: findings.repo,
      finality: createDevSingleNodeFinalizer(),
      gossip: createInMemoryGossip(),
      now: () => at,
      correlationBridgeCoverageAutoDisable: true,
      correlationBridgeCoveragePolicy: {
        threshold: 0.95,
        soakMs: SOAK_MS,
        minFindings: 5,
      },
    });

    const outcome = await service.submitFromDetection(
      tenantId,
      agentId,
      candidate(),
    );
    assert.equal(outcome.ok, false);
    if (outcome.ok) {
      assert.fail("expected disabled");
    }
    assert.equal(outcome.status, "bridge_disabled");
  });

  it("5. signed path remains unaffected while bridge is disabled", async () => {
    const { publicKeyEd25519, privateKey } = generateEd25519KeyPairForTests();
    const at = new Date("2026-07-01T12:00:00.000Z");
    const findings = memoryFindings(
      Array.from({ length: 5 }, (_, i) =>
        findingRow({
          id: String(i + 1),
          detectionSource: DETECTION_SOURCE_AGENT_SIGNED,
          createdAt: new Date(at.getTime() - SOAK_MS + i * 1000),
          windowBucket: new Date(bucket.getTime() + i * 60_000),
        }),
      ),
    );

    const service = createThreatEventService({
      deviceIdentities: activeIdentity(publicKeyEd25519),
      threatEvents: memoryThreatEvents(),
      findings: findings.repo,
      finality: createDevSingleNodeFinalizer(),
      gossip: createInMemoryGossip(),
      now: () => at,
      correlationBridgeCoverageAutoDisable: true,
      correlationBridgeCoveragePolicy: {
        threshold: 0.95,
        soakMs: SOAK_MS,
        minFindings: 5,
      },
    });

    const bridge = await service.submitFromDetection(
      tenantId,
      agentId,
      candidate(),
    );
    assert.equal(bridge.ok, false);

    const signed = await service.submitSigned(
      tenantId,
      agentId,
      signedEnvelope(privateKey, new Date("2026-03-02T00:00:00.000Z")),
    );
    assert.equal(signed.ok, true);
    if (!signed.ok || signed.status !== "created") {
      assert.fail("expected signed created");
    }
  });

  it("6. historical bridge rows remain readable and valid", async () => {
    const at = new Date("2026-07-01T12:00:00.000Z");
    const historical = findingRow({
      id: "bridge-hist",
      detectionSource: DETECTION_SOURCE_BRIDGE,
      createdAt: new Date(at.getTime() - 7 * SOAK_MS),
    });
    const findings = memoryFindings([historical]);

    const listed = await findings.repo.listFindings(tenantId, {
      limit: 10,
      offset: 0,
    });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.detectionSource, DETECTION_SOURCE_BRIDGE);
    assert.equal(listed[0]?.id, "bridge-hist");

    const byId = await findings.repo.getFindingById(tenantId, "bridge-hist");
    assert.equal(byId?.detectionSource, DETECTION_SOURCE_BRIDGE);
  });

  it("7. disablement is reversible via force-enable and auto-disable flag", async () => {
    const at = new Date("2026-07-01T12:00:00.000Z");
    const seed = Array.from({ length: 5 }, (_, i) =>
      findingRow({
        id: String(i + 1),
        detectionSource: DETECTION_SOURCE_AGENT_SIGNED,
        createdAt: new Date(at.getTime() - SOAK_MS + i * 1000),
        windowBucket: new Date(bucket.getTime() + (i + 10) * 60_000),
      }),
    );

    const policy = {
      threshold: 0.95,
      soakMs: SOAK_MS,
      minFindings: 5,
    } as const;

    const disabled = createThreatEventService({
      deviceIdentities: activeIdentity(),
      threatEvents: memoryThreatEvents(),
      findings: memoryFindings(seed).repo,
      finality: createDevSingleNodeFinalizer(),
      gossip: createInMemoryGossip(),
      now: () => at,
      correlationBridgeCoverageAutoDisable: true,
      correlationBridgeCoveragePolicy: policy,
    });
    assert.equal(
      (await disabled.submitFromDetection(tenantId, agentId, candidate())).ok,
      false,
    );

    const forceEnabled = createThreatEventService({
      deviceIdentities: activeIdentity(),
      threatEvents: memoryThreatEvents(),
      findings: memoryFindings(seed).repo,
      finality: createDevSingleNodeFinalizer(),
      gossip: createInMemoryGossip(),
      now: () => at,
      correlationBridgeCoverageAutoDisable: true,
      correlationBridgeCoveragePolicy: policy,
      correlationBridgeForceEnabledTenants: new Set([tenantId]),
    });
    const forced = await forceEnabled.submitFromDetection(
      tenantId,
      agentId,
      candidate(),
    );
    assert.equal(forced.ok, true);
    if (!forced.ok || forced.status !== "created") {
      assert.fail(`expected force-enabled create, got ${JSON.stringify(forced)}`);
    }

    const autoOff = createThreatEventService({
      deviceIdentities: activeIdentity(),
      threatEvents: memoryThreatEvents(),
      findings: memoryFindings(seed).repo,
      finality: createDevSingleNodeFinalizer(),
      gossip: createInMemoryGossip(),
      now: () => at,
      correlationBridgeCoverageAutoDisable: false,
      correlationBridgeCoveragePolicy: policy,
    });
    const reenabled = await autoOff.submitFromDetection(
      tenantId,
      agentId,
      candidate(),
    );
    assert.equal(reenabled.ok, true);
    if (!reenabled.ok || reenabled.status !== "created") {
      assert.fail(`expected auto-off create, got ${JSON.stringify(reenabled)}`);
    }
  });

  it("8. no provenance downgrade or history rewrite occurs", async () => {
    const { publicKeyEd25519, privateKey } = generateEd25519KeyPairForTests();
    const at = new Date("2026-07-01T12:00:00.000Z");
    const findings = memoryFindings([
      findingRow({
        id: "signed-1",
        detectionSource: DETECTION_SOURCE_AGENT_SIGNED,
        createdAt: new Date(at.getTime() - SOAK_MS),
      }),
      ...Array.from({ length: 4 }, (_, i) =>
        findingRow({
          id: `signed-${i + 2}`,
          detectionSource: DETECTION_SOURCE_AGENT_SIGNED,
          createdAt: new Date(at.getTime() - SOAK_MS + (i + 1) * 1000),
          windowBucket: new Date(bucket.getTime() + (i + 1) * 60_000),
        }),
      ),
    ]);

    const service = createThreatEventService({
      deviceIdentities: activeIdentity(publicKeyEd25519),
      threatEvents: memoryThreatEvents(),
      findings: findings.repo,
      finality: createDevSingleNodeFinalizer(),
      gossip: createInMemoryGossip(),
      now: () => at,
      correlationBridgeCoverageAutoDisable: true,
      correlationBridgeCoveragePolicy: {
        threshold: 0.95,
        soakMs: SOAK_MS,
        minFindings: 5,
      },
    });

    await service.submitFromDetection(tenantId, agentId, candidate());
    await service.submitSigned(
      tenantId,
      agentId,
      signedEnvelope(privateKey, new Date("2026-03-03T00:00:00.000Z")),
    );

    assert.equal(
      findings.rows.every(
        (r) => r.detectionSource === DETECTION_SOURCE_AGENT_SIGNED,
      ),
      true,
    );
  });

  it("9. config resolvers support reversible operator controls", () => {
    assert.equal(resolveCorrelationBridgeCoverageAutoDisable(undefined), false);
    assert.equal(resolveCorrelationBridgeCoverageAutoDisable("true"), true);
    assert.equal(resolveCorrelationBridgeCoverageThreshold(undefined), 0.95);
    assert.equal(resolveCorrelationBridgeCoverageSoakHours(undefined), 24);
    assert.equal(resolveCorrelationBridgeCoverageMinFindings(undefined), 5);
    assert.equal(
      resolveCorrelationBridgeForceEnabledTenants(tenantId).has(tenantId),
      true,
    );
  });

  it("10. global bridge control still works alongside tenant gating", async () => {
    const findings = memoryFindings();
    const service = createThreatEventService({
      deviceIdentities: activeIdentity(),
      threatEvents: memoryThreatEvents(),
      findings: findings.repo,
      finality: createDevSingleNodeFinalizer(),
      gossip: createInMemoryGossip(),
      correlationBridgeEnabled: false,
      correlationBridgeCoverageAutoDisable: false,
    });

    const outcome = await service.submitFromDetection(
      tenantId,
      agentId,
      candidate(),
    );
    assert.equal(outcome.ok, false);
    if (outcome.ok) {
      assert.fail("expected global disable");
    }
    assert.equal(outcome.status, "bridge_disabled");
  });
});
