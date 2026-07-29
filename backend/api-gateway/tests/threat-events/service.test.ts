import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CorrelationFindingsRepository } from "../../src/correlation/repository";
import type { DeviceIdentityRepository } from "../../src/threat-events/device-identity-repository";
import { createDevSingleNodeFinalizer } from "../../src/threat-events/finality";
import { createInMemoryGossip } from "../../src/threat-events/gossip";
import type {
  ThreatEventInsert,
  ThreatEventRow,
  ThreatEventsRepository,
} from "../../src/threat-events/repository";
import { createThreatEventService } from "../../src/threat-events/service";
import type { FinalityState } from "../../src/threat-events/envelope";
import {
  generateEd25519KeyPairForTests,
  signThreatEventEnvelope,
} from "../../src/threat-events/signature";

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const agentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const deviceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const bucket = new Date("2026-03-01T12:00:00.000Z");

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

function candidate() {
  return {
    ruleId: "agent.heartbeat_burst" as const,
    title: "Agent heartbeat burst",
    severity: "medium" as const,
    evidence: { totalInWindow: 30 },
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

describe("ThreatEventService finality gate", () => {
  it("does not create a finding when finality rejects", async () => {
    let findingsCalled = 0;
    const events = new Map<string, ThreatEventRow>();

    const deviceIdentities: DeviceIdentityRepository = {
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
        return undefined;
      },
      async insert() {
        throw new Error("not used");
      },
      async revoke() {
        return undefined;
      },
    };

    const threatEvents: ThreatEventsRepository = {
      async insertPending(_tid, input) {
        const id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
        const event = rowFromInsert(id, input);
        events.set(id, event);
        return { ok: true, event };
      },
      async getById(_tid, id) {
        return events.get(id);
      },
      async transitionFinality(_tid, id, to, options) {
        const current = events.get(id);
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
        events.set(id, next);
        return { ok: true, event: next };
      },
    };

    const findings = findingsStub({
      async insertFindingIgnoreDup() {
        findingsCalled += 1;
        return "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
      },
    });

    const service = createThreatEventService({
      deviceIdentities,
      threatEvents,
      findings,
      finality: {
        async finalize() {
          return {
            ok: false,
            state: "rejected",
            reason: "validator rejected",
          };
        },
      },
      gossip: createInMemoryGossip(),
      now: () => new Date("2026-03-01T12:01:00.000Z"),
    });

    const outcome = await service.submitFromDetection(
      tenantId,
      agentId,
      candidate(),
    );

    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.status, "rejected");
    }
    assert.equal(findingsCalled, 0);
    assert.equal(
      events.get("dddddddd-dddd-4ddd-8ddd-dddddddddddd")?.finalityState,
      "rejected",
    );
  });

  it("creates a finding only after finality succeeds", async () => {
    let findingsCalled = 0;
    const events = new Map<string, ThreatEventRow>();

    const deviceIdentities: DeviceIdentityRepository = {
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
        return undefined;
      },
      async insert() {
        throw new Error("not used");
      },
      async revoke() {
        return undefined;
      },
    };

    const threatEvents: ThreatEventsRepository = {
      async insertPending(_tid, input) {
        const id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
        const event = rowFromInsert(id, input);
        events.set(id, event);
        return { ok: true, event };
      },
      async getById(_tid, id) {
        return events.get(id);
      },
      async transitionFinality(_tid, id, to, options) {
        const current = events.get(id)!;
        const next = {
          ...current,
          finalityState: to,
          finalityReason: options.reason ?? null,
          finalizedAt: to === "finalized" ? options.at : null,
          findingId: options.findingId ?? null,
        };
        events.set(id, next);
        return { ok: true, event: next };
      },
    };

    const findings = findingsStub({
      async insertFindingIgnoreDup() {
        findingsCalled += 1;
        return "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
      },
    });

    const service = createThreatEventService({
      deviceIdentities,
      threatEvents,
      findings,
      finality: createDevSingleNodeFinalizer(),
      gossip: createInMemoryGossip(),
      now: () => new Date("2026-03-01T12:01:00.000Z"),
    });

    const outcome = await service.submitFromDetection(
      tenantId,
      agentId,
      candidate(),
    );

    assert.equal(outcome.ok, true);
    if (outcome.ok && outcome.status === "created") {
      assert.equal(outcome.findingId, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
    }
    assert.equal(findingsCalled, 1);
    assert.equal(
      events.get("dddddddd-dddd-4ddd-8ddd-dddddddddddd")?.finalityState,
      "finalized",
    );
  });

  it("fails closed without an active device identity", async () => {
    let findingsCalled = 0;
    const service = createThreatEventService({
      deviceIdentities: {
        async findByAgentId() {
          return undefined;
        },
        async findById() {
          return undefined;
        },
        async insert() {
          throw new Error("not used");
        },
        async revoke() {
          return undefined;
        },
      },
      threatEvents: {
        async insertPending() {
          throw new Error("should not insert");
        },
        async getById() {
          return undefined;
        },
        async transitionFinality() {
          throw new Error("should not transition");
        },
      },
      findings: findingsStub({
        async insertFindingIgnoreDup() {
          findingsCalled += 1;
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
      assert.equal(outcome.status, "no_identity");
    }
    assert.equal(findingsCalled, 0);
  });
});

describe("ThreatEventService submitSigned Ed25519 gate", () => {
  it("accepts a valid signature and creates a finding after finality", async () => {
    const { publicKeyEd25519, privateKey } = generateEd25519KeyPairForTests();
    let findingsCalled = 0;
    const events = new Map<string, ThreatEventRow>();

    const unsigned = {
      kind: "THREATEVENT" as const,
      tenantId,
      agentId,
      deviceIdentityId: deviceId,
      detectionRuleId: "agent.heartbeat_burst",
      title: "Agent heartbeat burst",
      severity: "medium" as const,
      evidence: { totalInWindow: 30 },
      windowStart: bucket,
      windowEnd: new Date("2026-03-01T12:01:00.000Z"),
      windowBucket: bucket,
      occurredAt: new Date("2026-03-01T12:01:00.000Z"),
      signedAt: new Date("2026-03-01T12:01:00.000Z"),
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
        async insertPending(_tid, input) {
          const id = "ffffffff-ffff-4fff-8fff-ffffffffffff";
          const event = rowFromInsert(id, input);
          events.set(id, event);
          return { ok: true, event };
        },
        async getById(_tid, id) {
          return events.get(id);
        },
        async transitionFinality(_tid, id, to, options) {
          const current = events.get(id);
          if (!current) {
            return { ok: false, reason: "not_found" };
          }
          const next = {
            ...current,
            finalityState: to,
            finalityReason: options.reason ?? null,
            finalizedAt: to === "finalized" ? options.at : null,
            findingId: options.findingId ?? null,
          };
          events.set(id, next);
          return { ok: true, event: next };
        },
      },
      findings: findingsStub({
        async insertFindingIgnoreDup() {
          findingsCalled += 1;
          return "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
        },
      }),
      finality: createDevSingleNodeFinalizer(),
      gossip: createInMemoryGossip(),
    });

    const outcome = await service.submitSigned(tenantId, agentId, envelope);
    assert.equal(outcome.ok, true);
    if (outcome.ok && outcome.status === "created") {
      assert.equal(outcome.findingId, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
    }
    assert.equal(findingsCalled, 1);
  });

  it("rejects a tampered signature before finality", async () => {
    const { publicKeyEd25519, privateKey } = generateEd25519KeyPairForTests();
    let findingsCalled = 0;
    let inserted = 0;

    const unsigned = {
      kind: "THREATEVENT" as const,
      tenantId,
      agentId,
      deviceIdentityId: deviceId,
      detectionRuleId: "agent.heartbeat_burst",
      title: "Agent heartbeat burst",
      severity: "medium" as const,
      evidence: {},
      windowStart: bucket,
      windowEnd: new Date("2026-03-01T12:01:00.000Z"),
      windowBucket: bucket,
      occurredAt: new Date("2026-03-01T12:01:00.000Z"),
      signedAt: new Date("2026-03-01T12:01:00.000Z"),
    };
    const goodSig = signThreatEventEnvelope(privateKey, unsigned);
    const envelope = {
      ...unsigned,
      title: "tampered title",
      signature: goodSig,
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
        async insertPending() {
          inserted += 1;
          throw new Error("should not insert");
        },
        async getById() {
          return undefined;
        },
        async transitionFinality() {
          throw new Error("should not transition");
        },
      },
      findings: findingsStub({
        async insertFindingIgnoreDup() {
          findingsCalled += 1;
          return "x";
        },
      }),
      finality: createDevSingleNodeFinalizer(),
      gossip: createInMemoryGossip(),
    });

    const outcome = await service.submitSigned(tenantId, agentId, envelope);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.status, "invalid_signature");
    }
    assert.equal(inserted, 0);
    assert.equal(findingsCalled, 0);
  });

  it("rejects revoked device identities", async () => {
    let findingsCalled = 0;
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
            publicKeyEd25519: "pk",
            deviceCertPem: null,
            status: "revoked",
            createdAt: new Date(),
            revokedAt: new Date(),
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
        async insertPending() {
          throw new Error("should not insert");
        },
        async getById() {
          return undefined;
        },
        async transitionFinality() {
          throw new Error("should not transition");
        },
      },
      findings: findingsStub({
        async insertFindingIgnoreDup() {
          findingsCalled += 1;
          return "x";
        },
      }),
      finality: createDevSingleNodeFinalizer(),
      gossip: createInMemoryGossip(),
    });

    const outcome = await service.submitSigned(tenantId, agentId, {
      kind: "THREATEVENT",
      tenantId,
      agentId,
      deviceIdentityId: deviceId,
      detectionRuleId: "agent.heartbeat_burst",
      title: "x",
      severity: "medium",
      evidence: {},
      windowStart: bucket,
      windowEnd: bucket,
      windowBucket: bucket,
      occurredAt: bucket,
      signature: "aa".repeat(32),
      signedAt: bucket,
    });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.status, "identity_revoked");
    }
    assert.equal(findingsCalled, 0);
  });
});
