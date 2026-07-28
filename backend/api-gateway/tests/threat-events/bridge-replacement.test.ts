/**
 * ADR-0005 bridge-replacement slice coverage.
 *
 * Proves: signed primary, bridge fallback, monotonic provenance upgrade,
 * tenant-aware disablement, finality gate, marker prohibition, rollback safety.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isCorrelationBridgeEnabledForTenant,
  resolveCorrelationBridgeDisabledTenants,
  resolveCorrelationBridgeEnabled,
} from "../../src/config/env";
import type {
  CorrelationFindingRow,
  CorrelationFindingsRepository,
} from "../../src/correlation/repository";
import {
  DETECTION_SOURCE_AGENT_SIGNED,
  DETECTION_SOURCE_BRIDGE,
} from "../../src/threat-events/provenance";
import { createDevSingleNodeFinalizer } from "../../src/threat-events/finality";
import { createInMemoryGossip } from "../../src/threat-events/gossip";
import {
  materializeFindingAfterFinality,
  type FinalizedEventProof,
} from "../../src/threat-events/materializer";
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
const tenantB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const agentId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const deviceId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const bucket = new Date("2026-03-01T12:00:00.000Z");

function candidate(evidence: Record<string, unknown> = {}) {
  return {
    ruleId: "agent.heartbeat_burst" as const,
    title: "Agent heartbeat burst",
    severity: "medium" as const,
    evidence,
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

function activeIdentity(
  publicKeyEd25519 = "pk",
): DeviceIdentityRepository {
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

function finalityProof(threatEventId: string): FinalizedEventProof {
  return {
    kind: "finality_success",
    threatEventId,
    state: "finalized",
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
      const existingId = byPath.get(key);
      if (existingId) {
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

function memoryFindings(): {
  repo: CorrelationFindingsRepository;
  rows: CorrelationFindingRow[];
  upgrades: Array<{ findingId: string; from: string; to: string }>;
} {
  const rows: CorrelationFindingRow[] = [];
  const upgrades: Array<{ findingId: string; from: string; to: string }> = [];
  let seq = 0;

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
      upgrades.push({ findingId: row.id, from: input.from, to: input.to });
      return row.id;
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

  return { repo, rows, upgrades };
}

function signedEnvelope(privateKey: ReturnType<typeof generateEd25519KeyPairForTests>["privateKey"]) {
  const unsigned = {
    kind: "THREATEVENT" as const,
    tenantId,
    agentId,
    deviceIdentityId: deviceId,
    detectionRuleId: "agent.heartbeat_burst" as const,
    title: "Agent heartbeat burst",
    severity: "medium" as const,
    evidence: { totalInWindow: 30 },
    windowStart: bucket,
    windowEnd: new Date("2026-03-01T12:01:00.000Z"),
    windowBucket: bucket,
    occurredAt: bucket,
    signedAt: bucket,
  };
  return {
    ...unsigned,
    signature: signThreatEventEnvelope(privateKey, unsigned),
  };
}

describe("ADR-0005 bridge-replacement config", () => {
  it("resolves global and per-tenant bridge gates without affecting each other incorrectly", () => {
    assert.equal(resolveCorrelationBridgeEnabled(undefined), true);
    assert.equal(resolveCorrelationBridgeEnabled("false"), false);
    const disabled = resolveCorrelationBridgeDisabledTenants(
      `${tenantId}, ${tenantB}`,
    );
    assert.equal(disabled.has(tenantId), true);
    assert.equal(
      isCorrelationBridgeEnabledForTenant(true, disabled, tenantId),
      false,
    );
    assert.equal(
      isCorrelationBridgeEnabledForTenant(true, disabled, "cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
      true,
    );
    assert.equal(
      isCorrelationBridgeEnabledForTenant(false, new Set(), tenantId),
      false,
    );
  });
});

describe("ADR-0005 bridge-replacement", () => {
  it("1. signed correlation inserts agent_signed through the materializer", async () => {
    const { publicKeyEd25519, privateKey } = generateEd25519KeyPairForTests();
    const findings = memoryFindings();
    const service = createThreatEventService({
      deviceIdentities: activeIdentity(publicKeyEd25519),
      threatEvents: memoryThreatEvents(),
      findings: findings.repo,
      finality: createDevSingleNodeFinalizer(),
      gossip: createInMemoryGossip(),
    });

    const outcome = await service.submitSigned(
      tenantId,
      agentId,
      signedEnvelope(privateKey),
    );
    assert.equal(outcome.ok, true);
    if (!outcome.ok || outcome.status !== "created") {
      assert.fail("expected created");
    }
    assert.equal(findings.rows.length, 1);
    assert.equal(findings.rows[0]?.detectionSource, DETECTION_SOURCE_AGENT_SIGNED);
  });

  it("2. bridge fallback still inserts bridge_correlation", async () => {
    const findings = memoryFindings();
    const service = createThreatEventService({
      deviceIdentities: activeIdentity(),
      threatEvents: memoryThreatEvents(),
      findings: findings.repo,
      finality: createDevSingleNodeFinalizer(),
      gossip: createInMemoryGossip(),
    });

    const outcome = await service.submitFromDetection(
      tenantId,
      agentId,
      candidate(),
    );
    assert.equal(outcome.ok, true);
    if (!outcome.ok || outcome.status !== "created") {
      assert.fail("expected created");
    }
    assert.equal(findings.rows[0]?.detectionSource, DETECTION_SOURCE_BRIDGE);
  });

  it("3. bridge then signed on same key upgrades to agent_signed and audits", async () => {
    const { publicKeyEd25519, privateKey } = generateEd25519KeyPairForTests();
    const findings = memoryFindings();
    const threatEvents = memoryThreatEvents();
    const service = createThreatEventService({
      deviceIdentities: activeIdentity(publicKeyEd25519),
      threatEvents,
      findings: findings.repo,
      finality: createDevSingleNodeFinalizer(),
      gossip: createInMemoryGossip(),
    });

    const bridge = await service.submitFromDetection(
      tenantId,
      agentId,
      candidate(),
    );
    assert.equal(bridge.ok, true);
    if (!bridge.ok || bridge.status !== "created") {
      assert.fail("expected bridge created");
    }

    const signed = await service.submitSigned(
      tenantId,
      agentId,
      signedEnvelope(privateKey),
    );
    assert.equal(signed.ok, true);
    if (!signed.ok || signed.status !== "upgraded") {
      assert.fail(`expected upgraded, got ${JSON.stringify(signed)}`);
    }
    assert.equal(findings.rows.length, 1);
    assert.equal(findings.rows[0]?.id, bridge.findingId);
    assert.equal(findings.rows[0]?.detectionSource, DETECTION_SOURCE_AGENT_SIGNED);
    assert.equal(findings.upgrades.length, 1);
    assert.deepEqual(findings.upgrades[0], {
      findingId: bridge.findingId,
      from: DETECTION_SOURCE_BRIDGE,
      to: DETECTION_SOURCE_AGENT_SIGNED,
    });
  });

  it("4. signed then bridge on same key remains agent_signed", async () => {
    const { publicKeyEd25519, privateKey } = generateEd25519KeyPairForTests();
    const findings = memoryFindings();
    const service = createThreatEventService({
      deviceIdentities: activeIdentity(publicKeyEd25519),
      threatEvents: memoryThreatEvents(),
      findings: findings.repo,
      finality: createDevSingleNodeFinalizer(),
      gossip: createInMemoryGossip(),
    });

    const signed = await service.submitSigned(
      tenantId,
      agentId,
      signedEnvelope(privateKey),
    );
    assert.equal(signed.ok, true);

    const bridge = await service.submitFromDetection(
      tenantId,
      agentId,
      candidate(),
    );
    assert.equal(bridge.ok, true);
    assert.equal(bridge.status, "deduped");
    assert.equal(findings.rows.length, 1);
    assert.equal(findings.rows[0]?.detectionSource, DETECTION_SOURCE_AGENT_SIGNED);
    assert.equal(findings.upgrades.length, 0);
  });

  it("5. same-source repeats dedup with no duplicate finding", async () => {
    const findings = memoryFindings();
    const service = createThreatEventService({
      deviceIdentities: activeIdentity(),
      threatEvents: memoryThreatEvents(),
      findings: findings.repo,
      finality: createDevSingleNodeFinalizer(),
      gossip: createInMemoryGossip(),
    });

    const first = await service.submitFromDetection(
      tenantId,
      agentId,
      candidate(),
    );
    const second = await service.submitFromDetection(
      tenantId,
      agentId,
      candidate(),
    );
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.status, "deduped");
    assert.equal(findings.rows.length, 1);
  });

  it("6. finality failure still blocks both paths", async () => {
    const { publicKeyEd25519, privateKey } = generateEd25519KeyPairForTests();
    const findings = memoryFindings();
    const rejecting = {
      async finalize() {
        return {
          ok: false as const,
          state: "rejected" as const,
          reason: "no",
        };
      },
    };

    const bridgeService = createThreatEventService({
      deviceIdentities: activeIdentity(),
      threatEvents: memoryThreatEvents(),
      findings: findings.repo,
      finality: rejecting,
      gossip: createInMemoryGossip(),
    });
    const signedService = createThreatEventService({
      deviceIdentities: activeIdentity(publicKeyEd25519),
      threatEvents: memoryThreatEvents(),
      findings: findings.repo,
      finality: rejecting,
      gossip: createInMemoryGossip(),
    });

    const bridge = await bridgeService.submitFromDetection(
      tenantId,
      agentId,
      candidate(),
    );
    const signed = await signedService.submitSigned(
      tenantId,
      agentId,
      signedEnvelope(privateKey),
    );
    assert.equal(bridge.ok, false);
    assert.equal(signed.ok, false);
    assert.equal(findings.rows.length, 0);
  });

  it("7. tenant isolation still holds for materializer upgrade lookup", async () => {
    const findings = memoryFindings();
    // Seed a bridge finding under tenant A.
    await findings.repo.insertFindingIgnoreDup(tenantId, {
      agentId,
      ruleId: "agent.heartbeat_burst",
      title: "t",
      severity: "medium",
      evidence: {},
      windowStart: bucket,
      windowEnd: bucket,
      windowBucket: bucket,
      detectionSource: DETECTION_SOURCE_BRIDGE,
    });

    const upgraded = await findings.repo.upgradeDetectionSourceMonotonic(
      tenantB,
      {
        agentId,
        ruleId: "agent.heartbeat_burst",
        windowBucket: bucket,
        from: DETECTION_SOURCE_BRIDGE,
        to: DETECTION_SOURCE_AGENT_SIGNED,
      },
    );
    assert.equal(upgraded, undefined);
    assert.equal(findings.rows[0]?.detectionSource, DETECTION_SOURCE_BRIDGE);
    assert.equal(findings.rows[0]?.tenantId, tenantId);
  });

  it("8. bridge marker prohibition still holds", async () => {
    const findings = memoryFindings();
    const service = createThreatEventService({
      deviceIdentities: activeIdentity(),
      threatEvents: memoryThreatEvents(),
      findings: findings.repo,
      finality: createDevSingleNodeFinalizer(),
      gossip: createInMemoryGossip(),
    });

    const outcome = await service.submitFromDetection(tenantId, agentId, {
      ...candidate({ signatureVerified: true }),
    });
    assert.equal(outcome.ok, false);
    if (outcome.ok) {
      assert.fail("expected rejection");
    }
    assert.equal(outcome.status, "provenance_rejected");
    assert.equal(findings.rows.length, 0);
  });

  it("9. tenant-aware bridge disablement does not affect signed correlation", async () => {
    const { publicKeyEd25519, privateKey } = generateEd25519KeyPairForTests();
    const findings = memoryFindings();
    const service = createThreatEventService({
      deviceIdentities: activeIdentity(publicKeyEd25519),
      threatEvents: memoryThreatEvents(),
      findings: findings.repo,
      finality: createDevSingleNodeFinalizer(),
      gossip: createInMemoryGossip(),
      correlationBridgeEnabled: true,
      correlationBridgeDisabledTenants: new Set([tenantId]),
    });

    const bridge = await service.submitFromDetection(
      tenantId,
      agentId,
      candidate(),
    );
    assert.equal(bridge.ok, false);
    if (bridge.ok) {
      assert.fail("expected bridge disabled");
    }
    assert.equal(bridge.status, "bridge_disabled");

    const signed = await service.submitSigned(
      tenantId,
      agentId,
      signedEnvelope(privateKey),
    );
    assert.equal(signed.ok, true);
    if (!signed.ok || signed.status !== "created") {
      assert.fail("expected signed created");
    }
    assert.equal(findings.rows[0]?.detectionSource, DETECTION_SOURCE_AGENT_SIGNED);
  });

  it("10. re-enabling bridge fallback does not damage existing agent_signed findings", async () => {
    const { publicKeyEd25519, privateKey } = generateEd25519KeyPairForTests();
    const findings = memoryFindings();
    const threatEvents = memoryThreatEvents();

    const disabled = createThreatEventService({
      deviceIdentities: activeIdentity(publicKeyEd25519),
      threatEvents,
      findings: findings.repo,
      finality: createDevSingleNodeFinalizer(),
      gossip: createInMemoryGossip(),
      correlationBridgeEnabled: true,
      correlationBridgeDisabledTenants: new Set([tenantId]),
    });

    const signed = await disabled.submitSigned(
      tenantId,
      agentId,
      signedEnvelope(privateKey),
    );
    assert.equal(signed.ok, true);

    const reenabled = createThreatEventService({
      deviceIdentities: activeIdentity(publicKeyEd25519),
      threatEvents,
      findings: findings.repo,
      finality: createDevSingleNodeFinalizer(),
      gossip: createInMemoryGossip(),
      correlationBridgeEnabled: true,
      correlationBridgeDisabledTenants: new Set(),
    });

    const bridge = await reenabled.submitFromDetection(
      tenantId,
      agentId,
      candidate(),
    );
    assert.equal(bridge.ok, true);
    assert.equal(bridge.status, "deduped");
    assert.equal(findings.rows.length, 1);
    assert.equal(findings.rows[0]?.detectionSource, DETECTION_SOURCE_AGENT_SIGNED);
  });

  it("materializer requires finality proof before upgrade", async () => {
    const findings = memoryFindings();
    await findings.repo.insertFindingIgnoreDup(tenantId, {
      agentId,
      ruleId: "agent.heartbeat_burst",
      title: "t",
      severity: "medium",
      evidence: {},
      windowStart: bucket,
      windowEnd: bucket,
      windowBucket: bucket,
      detectionSource: DETECTION_SOURCE_BRIDGE,
    });

    const result = await materializeFindingAfterFinality(findings.repo, {
      tenantId,
      agentId,
      ruleId: "agent.heartbeat_burst",
      title: "t",
      severity: "medium",
      evidence: {},
      windowStart: bucket,
      windowEnd: bucket,
      windowBucket: bucket,
      detectionSource: DETECTION_SOURCE_AGENT_SIGNED,
      path: "signed",
      threatEventId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      finalityProof: {
        kind: "finality_success",
        threatEventId: "wrong-id",
        state: "finalized",
      },
    });
    assert.equal(result.ok, false);
    assert.equal(findings.rows[0]?.detectionSource, DETECTION_SOURCE_BRIDGE);
  });

  it("materializer upgrades bridge to agent_signed with matching finality proof", async () => {
    const findings = memoryFindings();
    const id = await findings.repo.insertFindingIgnoreDup(tenantId, {
      agentId,
      ruleId: "agent.heartbeat_burst",
      title: "t",
      severity: "medium",
      evidence: {},
      windowStart: bucket,
      windowEnd: bucket,
      windowBucket: bucket,
      detectionSource: DETECTION_SOURCE_BRIDGE,
    });
    assert.ok(id);

    const threatEventId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const result = await materializeFindingAfterFinality(findings.repo, {
      tenantId,
      agentId,
      ruleId: "agent.heartbeat_burst",
      title: "t",
      severity: "medium",
      evidence: {},
      windowStart: bucket,
      windowEnd: bucket,
      windowBucket: bucket,
      detectionSource: DETECTION_SOURCE_AGENT_SIGNED,
      path: "signed",
      threatEventId,
      finalityProof: finalityProof(threatEventId),
    });
    assert.equal(result.ok, true);
    if (!result.ok || !("upgraded" in result) || !result.upgraded) {
      assert.fail("expected upgraded");
    }
    assert.equal(result.findingId, id);
    assert.equal(findings.rows[0]?.detectionSource, DETECTION_SOURCE_AGENT_SIGNED);
  });
});
