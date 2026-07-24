import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  generateAgentCredential,
  hashAgentCredential,
} from "../../src/agents/credential";

describe("agent credential hashing", () => {
  it("hashes deterministically and never returns the plaintext as the hash", () => {
    const { credential, credentialHash } = generateAgentCredential();
    assert.equal(hashAgentCredential(credential), credentialHash);
    assert.notEqual(credentialHash, credential);
    assert.match(credentialHash, /^[0-9a-f]{64}$/);
  });

  it("mints distinct credentials", () => {
    const a = generateAgentCredential();
    const b = generateAgentCredential();
    assert.notEqual(a.credential, b.credential);
    assert.notEqual(a.credentialHash, b.credentialHash);
  });
});
