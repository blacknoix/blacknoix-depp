import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertFinalityTransition,
  parseThreatEventEnvelope,
  THREAT_EVENT_KIND,
} from "../../src/threat-events/envelope";

const base = {
  kind: THREAT_EVENT_KIND,
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  agentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  deviceIdentityId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  detectionRuleId: "agent.heartbeat_burst",
  title: "Agent heartbeat burst",
  severity: "medium",
  evidence: { totalInWindow: 30 },
  windowStart: new Date("2026-03-01T12:00:00.000Z"),
  windowEnd: new Date("2026-03-01T12:01:00.000Z"),
  windowBucket: new Date("2026-03-01T12:00:00.000Z"),
  occurredAt: new Date("2026-03-01T12:01:00.000Z"),
  signature: "dev-sig",
  signedAt: new Date("2026-03-01T12:01:00.000Z"),
};

describe("parseThreatEventEnvelope", () => {
  it("accepts a minimal valid THREATEVENT", () => {
    const parsed = parseThreatEventEnvelope(base);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.envelope.kind, THREAT_EVENT_KIND);
      assert.equal(parsed.envelope.signature, "dev-sig");
    }
  });

  it("rejects missing signature and bad kind", () => {
    assert.equal(
      parseThreatEventEnvelope({ ...base, signature: "" }).ok,
      false,
    );
    assert.equal(
      parseThreatEventEnvelope({ ...base, kind: "OTHER" }).ok,
      false,
    );
  });

  it("rejects non-UUID tenant/agent", () => {
    assert.equal(
      parseThreatEventEnvelope({ ...base, tenantId: "not-a-uuid" }).ok,
      false,
    );
  });
});

describe("assertFinalityTransition", () => {
  it("allows pending to terminal states and rejects reverse", () => {
    assert.equal(assertFinalityTransition("pending", "finalized").ok, true);
    assert.equal(assertFinalityTransition("pending", "rejected").ok, true);
    assert.equal(
      assertFinalityTransition("pending", "analyst_review").ok,
      true,
    );
    assert.equal(assertFinalityTransition("finalized", "pending").ok, false);
    assert.equal(assertFinalityTransition("rejected", "finalized").ok, false);
  });
});
