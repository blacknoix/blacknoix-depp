import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  generateEd25519KeyPairForTests,
  parseEd25519PublicKeyBase64Url,
  signThreatEventEnvelope,
  verifyThreatEventSignature,
} from "../../src/threat-events/signature";

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const agentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const deviceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const at = new Date("2026-03-01T12:00:00.000Z");

describe("parseEd25519PublicKeyBase64Url", () => {
  it("accepts a real 32-byte raw key", () => {
    const { publicKeyEd25519 } = generateEd25519KeyPairForTests();
    const parsed = parseEd25519PublicKeyBase64Url(publicKeyEd25519);
    assert.equal(parsed.ok, true);
  });

  it("rejects malformed and wrong-length keys", () => {
    assert.equal(parseEd25519PublicKeyBase64Url("not-a-key").ok, false);
    assert.equal(parseEd25519PublicKeyBase64Url("YQ").ok, false); // 1 byte
    assert.equal(
      parseEd25519PublicKeyBase64Url(Buffer.alloc(31).toString("base64url")).ok,
      false,
    );
  });
});

describe("verifyThreatEventSignature", () => {
  it("verifies a valid signature and rejects tampering", () => {
    const { publicKeyEd25519, privateKey } = generateEd25519KeyPairForTests();
    const unsigned = {
      kind: "THREATEVENT" as const,
      tenantId,
      agentId,
      deviceIdentityId: deviceId,
      detectionRuleId: "agent.heartbeat_burst",
      title: "burst",
      severity: "medium" as const,
      evidence: { b: 2, a: 1 },
      windowStart: at,
      windowEnd: at,
      windowBucket: at,
      occurredAt: at,
      signedAt: at,
    };
    const signature = signThreatEventEnvelope(privateKey, unsigned);
    const envelope = { ...unsigned, signature };

    assert.equal(
      verifyThreatEventSignature(publicKeyEd25519, envelope).ok,
      true,
    );

    const tampered = { ...envelope, title: "other" };
    const bad = verifyThreatEventSignature(publicKeyEd25519, tampered);
    assert.equal(bad.ok, false);
    if (!bad.ok) {
      assert.equal(bad.reason, "invalid_signature");
    }
  });
});
