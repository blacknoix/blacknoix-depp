import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Opaque agent credential minting (ADR-0003 §5).
 *
 * Same construction as refresh tokens: 256-bit random secret, SHA-256 for
 * storage. Not a password KDF — the secret has no low-entropy structure.
 */

const CREDENTIAL_BYTES = 32;

export function hashAgentCredential(credential: string): string {
  return createHash("sha256").update(credential).digest("hex");
}

export function generateAgentCredential(): {
  credential: string;
  credentialHash: string;
} {
  const credential = randomBytes(CREDENTIAL_BYTES).toString("base64url");
  return { credential, credentialHash: hashAgentCredential(credential) };
}

/**
 * Constant-time hex digest compare. Length mismatch fails closed without
 * throwing timing noise from Buffer.from on unequal lengths via early return
 * after hashing both sides to fixed size (already fixed hex length).
 */
export function agentCredentialHashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}
