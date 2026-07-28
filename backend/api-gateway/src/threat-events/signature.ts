/**
 * Ed25519 helpers for device identity bind + THREATEVENT verify.
 *
 * Public keys and signatures are stored/transmitted as base64url (no padding)
 * over raw key/signature bytes (32 / 64). Canonical signing bytes are stable
 * UTF-8 JSON; the `signature` field is never included in the signed payload.
 */

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
  type KeyObject,
} from "node:crypto";

import type { ThreatEventEnvelope } from "./envelope";

/** SPKI DER prefix for a raw 32-byte Ed25519 public key. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** PKCS8 DER prefix for a raw 32-byte Ed25519 private key seed. */
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export type ParsePublicKeyResult =
  | { ok: true; raw: Buffer; keyObject: KeyObject }
  | { ok: false; message: string };

export type VerifySignatureResult =
  | { ok: true }
  | { ok: false; reason: "malformed_key" | "malformed_signature" | "invalid_signature" };

function decodeBase64Url(value: string): Buffer | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    const buf = Buffer.from(trimmed, "base64url");
    // Reject empty decode of non-empty garbage that still "succeeds".
    if (buf.length === 0 && trimmed.length > 0) {
      return null;
    }
    return buf;
  } catch {
    return null;
  }
}

/**
 * Accepts base64url-encoded raw 32-byte Ed25519 public keys only.
 * Fail closed on PEM, wrong length, or non-decodable input.
 */
export function parseEd25519PublicKeyBase64Url(
  value: string,
): ParsePublicKeyResult {
  if (typeof value !== "string") {
    return { ok: false, message: "publicKeyEd25519 must be a string" };
  }
  const raw = decodeBase64Url(value);
  if (!raw || raw.length !== 32) {
    return {
      ok: false,
      message: "publicKeyEd25519 must be base64url of 32 raw bytes",
    };
  }
  try {
    const keyObject = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
      format: "der",
      type: "spki",
    });
    return { ok: true, raw, keyObject };
  } catch {
    return { ok: false, message: "publicKeyEd25519 is not a valid Ed25519 key" };
  }
}

/**
 * Deterministic UTF-8 JSON bytes for Ed25519 signing/verification.
 * Dates are ISO-8601; evidence object keys are sorted recursively.
 * `signature` is intentionally excluded.
 */
export function canonicalThreatEventBytes(
  envelope: Omit<ThreatEventEnvelope, "signature">,
): Buffer {
  const payload = {
    kind: envelope.kind,
    tenantId: envelope.tenantId,
    agentId: envelope.agentId,
    deviceIdentityId: envelope.deviceIdentityId,
    detectionRuleId: envelope.detectionRuleId,
    title: envelope.title,
    severity: envelope.severity,
    evidence: sortJson(envelope.evidence),
    windowStart: envelope.windowStart.toISOString(),
    windowEnd: envelope.windowEnd.toISOString(),
    windowBucket: envelope.windowBucket.toISOString(),
    occurredAt: envelope.occurredAt.toISOString(),
    signedAt: envelope.signedAt.toISOString(),
  };
  return Buffer.from(JSON.stringify(payload), "utf8");
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortJson(obj[key]);
    }
    return out;
  }
  return value;
}

/**
 * Verify an Ed25519 signature (base64url raw 64 bytes) over canonical bytes.
 */
export function verifyThreatEventSignature(
  publicKeyEd25519: string,
  envelope: ThreatEventEnvelope,
): VerifySignatureResult {
  const parsedKey = parseEd25519PublicKeyBase64Url(publicKeyEd25519);
  if (!parsedKey.ok) {
    return { ok: false, reason: "malformed_key" };
  }

  const sigRaw = decodeBase64Url(envelope.signature);
  if (!sigRaw || sigRaw.length !== 64) {
    return { ok: false, reason: "malformed_signature" };
  }

  const message = canonicalThreatEventBytes(envelope);
  const valid = nodeVerify(null, message, parsedKey.keyObject, sigRaw);
  if (!valid) {
    return { ok: false, reason: "invalid_signature" };
  }
  return { ok: true };
}

/** Test/dev helper: mint an Ed25519 keypair (raw base64url public + PKCS8 private). */
export function generateEd25519KeyPairForTests(): {
  publicKeyEd25519: string;
  privateKey: KeyObject;
} {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ type: "spki", format: "der" });
  // SPKI for Ed25519 is prefix (12) + 32 raw bytes.
  const raw = Buffer.from(spki).subarray(ED25519_SPKI_PREFIX.length);
  return {
    publicKeyEd25519: raw.toString("base64url"),
    privateKey,
  };
}

/** Test/dev helper: sign canonical THREATEVENT bytes with a private KeyObject. */
export function signThreatEventEnvelope(
  privateKey: KeyObject,
  envelope: Omit<ThreatEventEnvelope, "signature">,
): string {
  const sig = nodeSign(null, canonicalThreatEventBytes(envelope), privateKey);
  return Buffer.from(sig).toString("base64url");
}

/** Reconstruct a KeyObject from raw 32-byte seed (tests only). */
export function privateKeyFromSeedBase64Url(seed: string): KeyObject {
  const raw = decodeBase64Url(seed);
  if (!raw || raw.length !== 32) {
    throw new Error("seed must be base64url of 32 bytes");
  }
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, raw]),
    format: "der",
    type: "pkcs8",
  });
}
