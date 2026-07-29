/**
 * ADR-0005 final bridge deletion — proves absence of the live bridge write
 * path and preservation of historical bridge_correlation rows + signed flow.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import type {
  CorrelationFindingRow,
  CorrelationFindingsRepository,
} from "../../src/correlation/repository";
import { createDevSingleNodeFinalizer } from "../../src/threat-events/finality";
import { createInMemoryGossip } from "../../src/threat-events/gossip";
import {
  materializeFindingAfterFinality,
  type FinalizedEventProof,
} from "../../src/threat-events/materializer";
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
import { env } from "../../src/config/env";

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const agentId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const deviceId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const bucket = new Date("2026-03-01T12:00:00.000Z");

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

function activeIdentity(publicKeyEd25519: string): DeviceIdentityRepository {
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
  const byPath = new Map<string, string>();
  let seq = 0;
  return {
    async insertPending(_tid, input) {
      const key = `${input.agentId}|${input.detectionRuleId}|${input.windowBucket.toISOString()}|${input.detectionSource}`;
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

function finalityProof(threatEventId: string): FinalizedEventProof {
  return {
    kind: "finality_success",
    threatEventId,
    state: "finalized",
  };
}

describe("ADR-0005 bridge deletion", () => {
  it("1. bridge submission path is gone from ThreatEventService", () => {
    const service = createThreatEventService({
      deviceIdentities: activeIdentity("pk"),
      threatEvents: memoryThreatEvents(),
      findings: memoryFindings().repo,
      finality: createDevSingleNodeFinalizer(),
      gossip: createInMemoryGossip(),
    });
    assert.equal(
      Object.prototype.hasOwnProperty.call(service, "submitFromDetection"),
      false,
    );
    assert.equal(typeof service.submitSigned, "function");

    const serviceSrc = fs.readFileSync(
      path.join(
        process.cwd(),
        "src",
        "threat-events",
        "service.ts",
      ),
      "utf8",
    );
    assert.equal(serviceSrc.includes("submitFromDetection"), false);
    assert.equal(serviceSrc.includes("buildDevBridgeSignature"), false);
    assert.equal(serviceSrc.includes("bridge-coverage"), false);
  });

  it("2. signed submission path still works unchanged", async () => {
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
    assert.equal(
      findings.rows[0]?.detectionSource,
      DETECTION_SOURCE_AGENT_SIGNED,
    );
  });

  it("3. historical bridge_correlation rows remain readable and valid", async () => {
    const findings = memoryFindings([
      {
        id: "bridge-hist",
        tenantId,
        agentId,
        ruleId: "agent.heartbeat_burst",
        title: "historical",
        severity: "medium",
        evidence: {},
        windowStart: bucket,
        windowEnd: bucket,
        windowBucket: bucket,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        status: "open",
        statusChangedAt: null,
        statusChangedByUserId: null,
        ownerUserId: null,
        ownerChangedAt: null,
        ownerChangedByUserId: null,
        operatorNote: null,
        operatorNoteUpdatedAt: null,
        operatorNoteUpdatedByUserId: null,
        detectionSource: DETECTION_SOURCE_BRIDGE,
      },
    ]);

    const listed = await findings.repo.listFindings(tenantId, {
      limit: 10,
      offset: 0,
    });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.detectionSource, DETECTION_SOURCE_BRIDGE);

    const byId = await findings.repo.getFindingById(tenantId, "bridge-hist");
    assert.equal(byId?.detectionSource, DETECTION_SOURCE_BRIDGE);
  });

  it("4. signed upgrades historical bridge without rewrite/downgrade of unrelated rows", async () => {
    const { publicKeyEd25519, privateKey } = generateEd25519KeyPairForTests();
    const otherBucket = new Date("2026-03-01T13:00:00.000Z");
    const findings = memoryFindings([
      {
        id: "bridge-1",
        tenantId,
        agentId,
        ruleId: "agent.heartbeat_burst",
        title: "bridge",
        severity: "medium",
        evidence: {},
        windowStart: bucket,
        windowEnd: bucket,
        windowBucket: bucket,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        status: "open",
        statusChangedAt: null,
        statusChangedByUserId: null,
        ownerUserId: null,
        ownerChangedAt: null,
        ownerChangedByUserId: null,
        operatorNote: null,
        operatorNoteUpdatedAt: null,
        operatorNoteUpdatedByUserId: null,
        detectionSource: DETECTION_SOURCE_BRIDGE,
      },
      {
        id: "signed-other",
        tenantId,
        agentId,
        ruleId: "agent.heartbeat_burst",
        title: "signed",
        severity: "medium",
        evidence: {},
        windowStart: otherBucket,
        windowEnd: otherBucket,
        windowBucket: otherBucket,
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        status: "open",
        statusChangedAt: null,
        statusChangedByUserId: null,
        ownerUserId: null,
        ownerChangedAt: null,
        ownerChangedByUserId: null,
        operatorNote: null,
        operatorNoteUpdatedAt: null,
        operatorNoteUpdatedByUserId: null,
        detectionSource: DETECTION_SOURCE_AGENT_SIGNED,
      },
    ]);

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
    if (!outcome.ok || outcome.status !== "upgraded") {
      assert.fail(`expected upgraded, got ${JSON.stringify(outcome)}`);
    }

    assert.equal(
      findings.rows.find((r) => r.id === "bridge-1")?.detectionSource,
      DETECTION_SOURCE_AGENT_SIGNED,
    );
    assert.equal(
      findings.rows.find((r) => r.id === "signed-other")?.detectionSource,
      DETECTION_SOURCE_AGENT_SIGNED,
    );
  });

  it("5. no bridge gating/config path is consulted at runtime", () => {
    assert.equal(
      Object.prototype.hasOwnProperty.call(env, "correlationBridgeEnabled"),
      false,
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        env,
        "correlationBridgeCoverageAutoDisable",
      ),
      false,
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        env,
        "correlationBridgeDisabledTenants",
      ),
      false,
    );

    const envSrc = fs.readFileSync(
      path.join(process.cwd(), "src", "config", "env.ts"),
      "utf8",
    );
    assert.equal(envSrc.includes("CORRELATION_BRIDGE"), false);

    const indexSrc = fs.readFileSync(
      path.join(process.cwd(), "src", "index.ts"),
      "utf8",
    );
    assert.equal(indexSrc.includes("correlationBridge"), false);

    assert.equal(
      fs.existsSync(
        path.join(process.cwd(), "src", "threat-events", "bridge-coverage.ts"),
      ),
      false,
    );
  });

  it("6. boot/config succeeds without bridge-specific env", () => {
    assert.ok(env.port > 0);
    assert.ok(typeof env.telemetryBatchMaxEvents === "number");
  });

  it("7. HTTP threat-events route uses submitSigned only", () => {
    const threatRoute = fs.readFileSync(
      path.join(process.cwd(), "src", "routes", "threat-events.ts"),
      "utf8",
    );
    assert.match(threatRoute, /submitSigned\(/);
    assert.equal(threatRoute.includes("submitFromDetection"), false);

    const corr = fs.readFileSync(
      path.join(process.cwd(), "src", "correlation", "service.ts"),
      "utf8",
    );
    assert.equal(corr.includes("submitFromDetection"), false);
    assert.match(corr, /correlation_bridge_write_path_deleted/);
  });

  it("8. finality/materializer signed flow is unchanged", async () => {
    let inserted = 0;
    const threatEventId = "eeeeeeee-eeee-4eee-8eee-000000000001";
    const result = await materializeFindingAfterFinality(
      {
        async insertFindingIgnoreDup() {
          inserted += 1;
          return "finding-1";
        },
        async upgradeDetectionSourceMonotonic() {
          return undefined;
        },
      } as unknown as CorrelationFindingsRepository,
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
        threatEventId,
        finalityProof: finalityProof(threatEventId),
      },
    );
    assert.equal(result.ok, true);
    assert.equal(inserted, 1);

    const rejected = await materializeFindingAfterFinality(
      {
        async insertFindingIgnoreDup() {
          throw new Error("must not insert");
        },
      } as unknown as CorrelationFindingsRepository,
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
        threatEventId,
        finalityProof: finalityProof("wrong-id"),
      },
    );
    assert.equal(rejected.ok, false);
  });
});
