import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import type { CorrelationFindingsRepository } from "../../src/correlation/repository";
import { createDevSingleNodeFinalizer } from "../../src/threat-events/finality";
import { createInMemoryGossip } from "../../src/threat-events/gossip";
import { materializeFindingAfterFinality } from "../../src/threat-events/materializer";
import type { FinalizedEventProof } from "../../src/threat-events/materializer";
import {
  assertBridgeEvidenceClean,
  assertMaterializerProvenance,
  assertSignedEvidenceClean,
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
const agentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const deviceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
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

function activeIdentity(): DeviceIdentityRepository {
  return {
    async findByAgentId() {
      return {
        id: deviceId,
        tenantId,
        agentId,
        publicKeyEd25519: "pk",
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
        publicKeyEd25519: "pk",
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

/** Minimal findings stubs for tests that only care about insert / skip. */
function findingsStub(
  overrides: Partial<CorrelationFindingsRepository> = {},
): CorrelationFindingsRepository {
  return {
    async insertFindingIgnoreDup() {
      return "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    },
    async findFindingByDedupKey() {
      return undefined;
    },
    async upgradeDetectionSourceMonotonic() {
      return undefined;
    },
    async listFindings() {
      return [];
    },
    async getFindingById() {
      return undefined;
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
    async getBridgeCoverageCounts() {
      return {
        signedCount: 0,
        bridgeCount: 0,
        firstSignedAt: null,
        oldestInWindowAt: null,
      };
    },
    ...overrides,
  };
}

describe("ADR-0005 provenance integrity", () => {
  it("bridge-created finding persists detection_source equal to bridge_correlation", async () => {
    let storedSource: string | undefined;
    const service = createThreatEventService({
      deviceIdentities: activeIdentity(),
      threatEvents: {
        async insertPending(_t, input) {
          return {
            ok: true,
            event: rowFromInsert("dddddddd-dddd-4ddd-8ddd-dddddddddddd", input),
          };
        },
        async getById() {
          return undefined;
        },
        async transitionFinality() {
          return {
            ok: true,
            event: rowFromInsert(
              "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              {
                agentId,
                deviceIdentityId: deviceId,
                detectionRuleId: "agent.heartbeat_burst",
                title: "t",
                severity: "medium",
                evidence: {},
                windowStart: bucket,
                windowEnd: bucket,
                windowBucket: bucket,
                occurredAt: bucket,
                signature: "s",
                signedAt: bucket,
              detectionSource: DETECTION_SOURCE_BRIDGE,
              },
              "finalized",
            ),
          };
        },
      },
      findings: findingsStub({
        async insertFindingIgnoreDup(
          _t: string,
          finding: { detectionSource: string },
        ) {
          storedSource = finding.detectionSource;
          return "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
        },
      }),
      finality: createDevSingleNodeFinalizer(),
      gossip: createInMemoryGossip(),
    });

    const outcome = await service.submitFromDetection(
      tenantId,
      agentId,
      candidate(),
    );
    assert.equal(outcome.ok, true);
    assert.equal(storedSource, DETECTION_SOURCE_BRIDGE);
  });

  it("signed-created finding never persists detection_source equal to bridge_correlation", async () => {
    const { publicKeyEd25519, privateKey } = generateEd25519KeyPairForTests();
    let storedSource: string | undefined;
    const unsigned = {
      kind: "THREATEVENT" as const,
      tenantId,
      agentId,
      deviceIdentityId: deviceId,
      detectionRuleId: "agent.heartbeat_burst",
      title: "burst",
      severity: "medium" as const,
      evidence: {},
      windowStart: bucket,
      windowEnd: bucket,
      windowBucket: bucket,
      occurredAt: bucket,
      signedAt: bucket,
    };
    const envelope = {
      ...unsigned,
      signature: signThreatEventEnvelope(privateKey, unsigned),
    };

    const service = createThreatEventService({
      deviceIdentities: {
        async findByAgentId() {
          return undefined;
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
      },
      threatEvents: {
        async insertPending(_t, input) {
          return {
            ok: true,
            event: rowFromInsert("ffffffff-ffff-4fff-8fff-ffffffffffff", input),
          };
        },
        async getById() {
          return undefined;
        },
        async transitionFinality() {
          return {
            ok: true,
            event: rowFromInsert(
              "ffffffff-ffff-4fff-8fff-ffffffffffff",
              {
                agentId,
                deviceIdentityId: deviceId,
                detectionRuleId: "agent.heartbeat_burst",
                title: "t",
                severity: "medium",
                evidence: {},
                windowStart: bucket,
                windowEnd: bucket,
                windowBucket: bucket,
                occurredAt: bucket,
                signature: "s",
                signedAt: bucket,
              detectionSource: DETECTION_SOURCE_BRIDGE,
              },
              "finalized",
            ),
          };
        },
      },
      findings: findingsStub({
        async insertFindingIgnoreDup(
          _t: string,
          finding: { detectionSource: string },
        ) {
          storedSource = finding.detectionSource;
          return "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
        },
      }),
      finality: createDevSingleNodeFinalizer(),
      gossip: createInMemoryGossip(),
    });

    const outcome = await service.submitSigned(tenantId, agentId, envelope);
    assert.equal(outcome.ok, true);
    assert.equal(storedSource, DETECTION_SOURCE_AGENT_SIGNED);
    assert.notEqual(storedSource, DETECTION_SOURCE_BRIDGE);
  });

  it("bridge-created finding never persists a signed-detection provenance value", () => {
    assert.equal(
      assertMaterializerProvenance("bridge", DETECTION_SOURCE_AGENT_SIGNED).ok,
      false,
    );
  });

  it("bridge-created finding never records an Ed25519-verified or signature-valid marker for the placeholder signature", () => {
    assert.equal(
      assertBridgeEvidenceClean({ signatureVerified: true }).ok,
      false,
    );
    assert.equal(assertBridgeEvidenceClean({ ed25519Verified: true }).ok, false);
    assert.equal(assertBridgeEvidenceClean({ totalInWindow: 30 }).ok, true);
  });

  it("attempting to materialize bridge path with a signed provenance label fails closed", async () => {
    const threatEventId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const result = await materializeFindingAfterFinality(
      findingsStub({
        async insertFindingIgnoreDup() {
          throw new Error("must not insert");
        },
      }),
      {
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
        path: "bridge",
        threatEventId,
        finalityProof: finalityProof(threatEventId),
      },
    );
    assert.equal(result.ok, false);
  });

  it("attempting to materialize signed path with detection_source bridge_correlation fails closed", async () => {
    const threatEventId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const result = await materializeFindingAfterFinality(
      findingsStub({
        async insertFindingIgnoreDup() {
          throw new Error("must not insert");
        },
      }),
      {
        tenantId,
        agentId,
        ruleId: "agent.heartbeat_burst",
        title: "t",
        severity: "medium",
        evidence: {},
        windowStart: bucket,
        windowEnd: bucket,
        windowBucket: bucket,
        detectionSource: DETECTION_SOURCE_BRIDGE,
        path: "signed",
        threatEventId,
        finalityProof: finalityProof(threatEventId),
      },
    );
    assert.equal(result.ok, false);
  });

  it("materializer rejects insert without a matching finality proof", async () => {
    let inserted = 0;
    const threatEventId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const result = await materializeFindingAfterFinality(
      findingsStub({
        async insertFindingIgnoreDup() {
          inserted += 1;
          return "x";
        },
      }),
      {
        tenantId,
        agentId,
        ruleId: "agent.heartbeat_burst",
        title: "t",
        severity: "medium",
        evidence: {},
        windowStart: bucket,
        windowEnd: bucket,
        windowBucket: bucket,
        detectionSource: DETECTION_SOURCE_BRIDGE,
        path: "bridge",
        threatEventId,
        finalityProof: finalityProof("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
      },
    );
    assert.equal(result.ok, false);
    assert.equal(inserted, 0);
  });

  it("submitFromDetection rejects evidence carrying signed markers", async () => {
    const service = createThreatEventService({
      deviceIdentities: activeIdentity(),
      threatEvents: {
        async insertPending() {
          throw new Error("must not insert");
        },
        async getById() {
          return undefined;
        },
        async transitionFinality() {
          throw new Error("must not transition");
        },
      },
      findings: findingsStub({
        async insertFindingIgnoreDup() {
          throw new Error("must not insert finding");
        },
      }),
      finality: createDevSingleNodeFinalizer(),
      gossip: createInMemoryGossip(),
    });

    const outcome = await service.submitFromDetection(
      tenantId,
      agentId,
      candidate({ signatureVerified: true }),
    );
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.status, "provenance_rejected");
    }
  });

  it("submitSigned rejects evidence claiming bridge_correlation", async () => {
    const check = assertSignedEvidenceClean({
      detection_source: DETECTION_SOURCE_BRIDGE,
    });
    assert.equal(check.ok, false);
  });
});

describe("ADR-0005 finality gate", () => {
  it("bridge materialization does not insert a finding when finality.finalize returns failure", async () => {
    let findingsCalled = 0;
    let finalState: FinalityState | undefined;
    const events = new Map<string, ThreatEventRow>();

    const service = createThreatEventService({
      deviceIdentities: activeIdentity(),
      threatEvents: {
        async insertPending(_t, input) {
          const id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
          const event = rowFromInsert(id, input);
          events.set(id, event);
          return { ok: true, event };
        },
        async getById(_t, id) {
          return events.get(id);
        },
        async transitionFinality(_t, id, to) {
          const current = events.get(id)!;
          finalState = to;
          const next = { ...current, finalityState: to, findingId: null };
          events.set(id, next);
          return { ok: true, event: next };
        },
      },
      findings: findingsStub({
        async insertFindingIgnoreDup() {
          findingsCalled += 1;
          return "x";
        },
      }),
      finality: {
        async finalize() {
          return { ok: false, state: "rejected", reason: "no" };
        },
      },
      gossip: createInMemoryGossip(),
    });

    const outcome = await service.submitFromDetection(
      tenantId,
      agentId,
      candidate(),
    );
    assert.equal(outcome.ok, false);
    assert.equal(findingsCalled, 0);
    assert.equal(finalState, "rejected");
    assert.equal(
      events.get("dddddddd-dddd-4ddd-8ddd-dddddddddddd")?.findingId,
      null,
    );
  });

  it("finding insert is not invoked before finality.finalize resolves successfully", async () => {
    const order: string[] = [];
    const service = createThreatEventService({
      deviceIdentities: activeIdentity(),
      threatEvents: {
        async insertPending(_t, input) {
          return {
            ok: true,
            event: rowFromInsert("dddddddd-dddd-4ddd-8ddd-dddddddddddd", input),
          };
        },
        async getById() {
          return undefined;
        },
        async transitionFinality() {
          order.push("transition");
          return {
            ok: true,
            event: rowFromInsert(
              "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              {
                agentId,
                deviceIdentityId: deviceId,
                detectionRuleId: "agent.heartbeat_burst",
                title: "t",
                severity: "medium",
                evidence: {},
                windowStart: bucket,
                windowEnd: bucket,
                windowBucket: bucket,
                occurredAt: bucket,
                signature: "s",
                signedAt: bucket,
              detectionSource: DETECTION_SOURCE_BRIDGE,
              },
              "finalized",
            ),
          };
        },
      },
      findings: findingsStub({
        async insertFindingIgnoreDup() {
          order.push("insert");
          return "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
        },
      }),
      finality: {
        async finalize() {
          order.push("finalize");
          return { ok: true, state: "finalized" };
        },
      },
      gossip: createInMemoryGossip(),
    });

    await service.submitFromDetection(tenantId, agentId, candidate());
    assert.deepEqual(order.slice(0, 2), ["finalize", "insert"]);
  });
});

describe("ADR-0005 agent-identity gate", () => {
  it("bridge submitFromDetection fails closed when device identity is missing", async () => {
    const service = createThreatEventService({
      deviceIdentities: {
        async findByAgentId() {
          return undefined;
        },
        async findById() {
          return undefined;
        },
        async insert() {
          throw new Error("n");
        },
        async revoke() {
          return undefined;
        },
      },
      threatEvents: {
        async insertPending() {
          throw new Error("must not");
        },
        async getById() {
          return undefined;
        },
        async transitionFinality() {
          throw new Error("must not");
        },
      },
      findings: findingsStub({
        async insertFindingIgnoreDup() {
          throw new Error("must not");
        },
      }),
      finality: createDevSingleNodeFinalizer(),
      gossip: createInMemoryGossip(),
    });
    const outcome = await service.submitFromDetection(
      tenantId,
      agentId,
      candidate(),
    );
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.status, "no_identity");
    }
  });

  it("bridge submitFromDetection fails closed when device identity is revoked", async () => {
    const service = createThreatEventService({
      deviceIdentities: {
        async findByAgentId() {
          return {
            id: deviceId,
            tenantId,
            agentId,
            publicKeyEd25519: "pk",
            deviceCertPem: null,
            status: "revoked",
            createdAt: new Date(),
            revokedAt: new Date(),
          };
        },
        async findById() {
          return undefined;
        },
        async insert() {
          throw new Error("n");
        },
        async revoke() {
          return undefined;
        },
      },
      threatEvents: {
        async insertPending() {
          throw new Error("must not");
        },
        async getById() {
          return undefined;
        },
        async transitionFinality() {
          throw new Error("must not");
        },
      },
      findings: findingsStub({
        async insertFindingIgnoreDup() {
          throw new Error("must not");
        },
      }),
      finality: createDevSingleNodeFinalizer(),
      gossip: createInMemoryGossip(),
    });
    const outcome = await service.submitFromDetection(
      tenantId,
      agentId,
      candidate(),
    );
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.status, "identity_revoked");
    }
  });
});

describe("ADR-0005 flag off behavior", () => {
  it("when the bridge feature flag is off, submitFromDetection does not insert threat_events pending for materialization intent that yields a finding", async () => {
    let pending = 0;
    let findings = 0;
    const service = createThreatEventService({
      correlationBridgeEnabled: false,
      deviceIdentities: activeIdentity(),
      threatEvents: {
        async insertPending() {
          pending += 1;
          throw new Error("must not");
        },
        async getById() {
          return undefined;
        },
        async transitionFinality() {
          throw new Error("must not");
        },
      },
      findings: findingsStub({
        async insertFindingIgnoreDup() {
          findings += 1;
          return "x";
        },
      }),
      finality: createDevSingleNodeFinalizer(),
      gossip: createInMemoryGossip(),
    });

    const outcome = await service.submitFromDetection(
      tenantId,
      agentId,
      candidate(),
    );
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.status, "bridge_disabled");
    }
    assert.equal(pending, 0);
    assert.equal(findings, 0);
  });
});

describe("ADR-0005 single materializer + caller restriction (static)", () => {
  it("no correlation or telemetry path calls insertFindingIgnoreDup directly for detection materialization", () => {
    const root = path.resolve(__dirname, "../../src");
    const corr = fs.readFileSync(
      path.join(root, "correlation/service.ts"),
      "utf8",
    );
    const telem = fs.readFileSync(
      path.join(root, "telemetry/service.ts"),
      "utf8",
    );
    assert.equal(corr.includes("insertFindingIgnoreDup"), false);
    assert.equal(telem.includes("insertFindingIgnoreDup"), false);
  });

  it("submitFromDetection and submitSigned both reach findings insert only via the same post-finality helper", () => {
    const serviceSrc = fs.readFileSync(
      path.resolve(__dirname, "../../src/threat-events/service.ts"),
      "utf8",
    );
    assert.equal(serviceSrc.includes("materializeFindingAfterFinality"), true);
    assert.equal(
      serviceSrc.includes("findings.insertFindingIgnoreDup"),
      false,
    );
  });

  it("HTTP agent routes cannot invoke submitFromDetection", () => {
    const threatRoute = fs.readFileSync(
      path.resolve(__dirname, "../../src/routes/threat-events.ts"),
      "utf8",
    );
    const agentsRoute = fs.readFileSync(
      path.resolve(__dirname, "../../src/routes/agents.ts"),
      "utf8",
    );
    assert.equal(threatRoute.includes("submitFromDetection"), false);
    assert.equal(agentsRoute.includes("submitFromDetection"), false);
    assert.equal(threatRoute.includes("submitSigned"), true);
  });

  it("POST /v1/threat-events uses submitSigned only", () => {
    const threatRoute = fs.readFileSync(
      path.resolve(__dirname, "../../src/routes/threat-events.ts"),
      "utf8",
    );
    assert.match(threatRoute, /submitSigned\(/);
    assert.equal(threatRoute.includes("submitFromDetection"), false);
  });
});
