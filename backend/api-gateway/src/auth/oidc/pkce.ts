import { createHash, randomBytes } from "node:crypto";

/**
 * Cryptographic primitives for OIDC login initiation (RFC 6749 state,
 * OIDC nonce, RFC 7636 PKCE).
 *
 * All values are high-entropy random. base64url of 32 bytes is 43 characters
 * drawn from [A-Za-z0-9-_], which satisfies the PKCE code_verifier grammar, so
 * the same generator serves state, nonce, and verifier.
 */

const DEFAULT_BYTES = 32;

export function randomToken(bytes: number = DEFAULT_BYTES): string {
  return randomBytes(bytes).toString("base64url");
}

export function generateState(): string {
  return randomToken();
}

export function generateNonce(): string {
  return randomToken();
}

export interface Pkce {
  verifier: string;
  challenge: string;
}

/**
 * Generates a PKCE verifier and its S256 challenge. S256 only — the `plain`
 * method offers no protection against a leaked authorization request and is
 * never used.
 */
export function generatePkce(): Pkce {
  const verifier = randomToken();
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  return { verifier, challenge };
}
