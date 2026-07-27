import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveJwtConfig } from "../src/auth/jwt/config";

const base = {
  JWT_ACCESS_SECRET: "s".repeat(32),
  JWT_ISSUER: "depp",
  JWT_AUDIENCE: "depp-api",
};

describe("resolveJwtConfig (fail closed)", () => {
  it("resolves a valid configuration with the default TTL", () => {
    const config = resolveJwtConfig(base);

    assert.equal(config.issuer, "depp");
    assert.equal(config.audience, "depp-api");
    assert.equal(config.accessTtlSeconds, 900);
  });

  it("honours a valid explicit TTL", () => {
    const config = resolveJwtConfig({ ...base, JWT_ACCESS_TTL_SECONDS: "300" });
    assert.equal(config.accessTtlSeconds, 300);
  });

  it("rejects a missing or too-short secret", () => {
    assert.throws(() => resolveJwtConfig({ ...base, JWT_ACCESS_SECRET: undefined }), /JWT_ACCESS_SECRET/);
    assert.throws(() => resolveJwtConfig({ ...base, JWT_ACCESS_SECRET: "short" }), /at least 32/);
  });

  it("rejects a missing issuer or audience", () => {
    assert.throws(() => resolveJwtConfig({ ...base, JWT_ISSUER: undefined }), /JWT_ISSUER/);
    assert.throws(() => resolveJwtConfig({ ...base, JWT_AUDIENCE: "  " }), /JWT_AUDIENCE/);
  });

  it("rejects an out-of-range or non-integer TTL", () => {
    assert.throws(() => resolveJwtConfig({ ...base, JWT_ACCESS_TTL_SECONDS: "0" }), /JWT_ACCESS_TTL_SECONDS/);
    assert.throws(() => resolveJwtConfig({ ...base, JWT_ACCESS_TTL_SECONDS: "99999" }), /JWT_ACCESS_TTL_SECONDS/);
    assert.throws(() => resolveJwtConfig({ ...base, JWT_ACCESS_TTL_SECONDS: "abc" }), /JWT_ACCESS_TTL_SECONDS/);
  });
});
