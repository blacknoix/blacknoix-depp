import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { generateNonce, generatePkce, generateState } from "../src/auth/oidc/pkce";

describe("OIDC pkce/state/nonce generation", () => {
  it("generates distinct, high-entropy state and nonce values", () => {
    const a = generateState();
    const b = generateState();
    assert.notEqual(a, b);
    assert.equal(generateNonce().length >= 43, true); // 32 bytes base64url
    assert.match(a, /^[A-Za-z0-9_-]+$/); // base64url, PKCE-safe alphabet
  });

  it("derives the S256 challenge from the verifier", () => {
    const { verifier, challenge } = generatePkce();
    const expected = createHash("sha256").update(verifier).digest("base64url");
    assert.equal(challenge, expected);
    assert.notEqual(challenge, verifier);
  });
});
