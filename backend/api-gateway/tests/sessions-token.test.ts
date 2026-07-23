import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generateRefreshToken, hashRefreshToken } from "../src/sessions/refresh-token";

describe("refresh-token hashing", () => {
  it("hashes deterministically", () => {
    assert.equal(hashRefreshToken("abc"), hashRefreshToken("abc"));
    assert.notEqual(hashRefreshToken("abc"), hashRefreshToken("abd"));
  });

  it("produces a SHA-256 hex digest, not the plaintext", () => {
    const { token, tokenHash } = generateRefreshToken();

    assert.match(tokenHash, /^[0-9a-f]{64}$/);
    assert.notEqual(tokenHash, token);
    assert.equal(tokenHash, hashRefreshToken(token));
  });

  it("mints distinct tokens", () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();

    assert.notEqual(a.token, b.token);
    assert.notEqual(a.tokenHash, b.tokenHash);
  });
});
