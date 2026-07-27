import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { discoverOidc } from "../src/auth/oidc/discovery";

const ISSUER = "https://accounts.example.com";

function fetchReturning(status: number, body: unknown): typeof globalThis.fetch {
  return (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as Response) as unknown as typeof globalThis.fetch;
}

describe("discoverOidc", () => {
  it("returns the token and jwks endpoints on a matching document", async () => {
    const fetchImpl = fetchReturning(200, {
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      jwks_uri: `${ISSUER}/jwks`,
    });

    const endpoints = await discoverOidc(ISSUER, fetchImpl);

    assert.equal(endpoints.tokenEndpoint, `${ISSUER}/token`);
    assert.equal(endpoints.jwksUri, `${ISSUER}/jwks`);
  });

  it("rejects a document whose issuer does not match (rogue metadata)", async () => {
    const fetchImpl = fetchReturning(200, {
      issuer: "https://evil.example.com",
      token_endpoint: `${ISSUER}/token`,
      jwks_uri: `${ISSUER}/jwks`,
    });

    await assert.rejects(() => discoverOidc(ISSUER, fetchImpl), /issuer mismatch/);
  });

  it("rejects a non-2xx discovery response", async () => {
    await assert.rejects(() => discoverOidc(ISSUER, fetchReturning(404, {})), /HTTP 404/);
  });

  it("rejects a document missing required endpoints", async () => {
    const fetchImpl = fetchReturning(200, { issuer: ISSUER, token_endpoint: `${ISSUER}/token` });
    await assert.rejects(() => discoverOidc(ISSUER, fetchImpl), /missing authorization_endpoint/);
  });
});
