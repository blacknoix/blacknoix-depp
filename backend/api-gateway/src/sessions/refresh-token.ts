import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;

/**
 * Hashes an opaque refresh token for storage and lookup.
 *
 * SHA-256, not a password KDF, is the right choice here: a refresh token is a
 * 256-bit random secret, so it has no low-entropy structure to brute-force. A
 * slow KDF would add latency on every refresh without adding security. The hash
 * exists so a database read never exposes a usable token.
 */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Mints a new opaque refresh token: a high-entropy random value plus its hash.
 * The caller returns `token` to the client exactly once and persists only
 * `tokenHash`.
 */
export function generateRefreshToken(): { token: string; tokenHash: string } {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");

  return { token, tokenHash: hashRefreshToken(token) };
}
