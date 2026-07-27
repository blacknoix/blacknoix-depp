import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveOidcConfig } from "../src/auth/oidc/config";

const base = {
  OIDC_ISSUER: "https://accounts.example.com",
  OIDC_CLIENT_ID: "client-123",
  OIDC_CLIENT_SECRET: "shhh",
  OIDC_REDIRECT_URI: "https://api.example.com/v1/auth/oidc/callback",
  OIDC_TENANT_ID: "11111111-1111-4111-8111-111111111111",
};

describe("resolveOidcConfig (fail closed)", () => {
  it("returns undefined when OIDC is not enabled", () => {
    assert.equal(resolveOidcConfig({}), undefined);
  });

  it("resolves a complete, valid configuration with initiation defaults", () => {
    const config = resolveOidcConfig(base);
    assert.equal(config?.issuer, base.OIDC_ISSUER);
    assert.equal(config?.clientId, "client-123");
    assert.equal(config?.tenantId, base.OIDC_TENANT_ID);
    assert.match(config?.scope ?? "", /\bopenid\b/);
    assert.equal(config?.initiationTtlSeconds, 300);
  });

  it("requires openid in the scope and validates the initiation TTL", () => {
    assert.throws(() => resolveOidcConfig({ ...base, OIDC_SCOPE: "email profile" }), /openid/);
    assert.throws(
      () => resolveOidcConfig({ ...base, OIDC_INITIATION_TTL_SECONDS: "5" }),
      /OIDC_INITIATION_TTL_SECONDS/,
    );
    assert.throws(
      () => resolveOidcConfig({ ...base, OIDC_INITIATION_TTL_SECONDS: "abc" }),
      /OIDC_INITIATION_TTL_SECONDS/,
    );
    assert.equal(
      resolveOidcConfig({ ...base, OIDC_INITIATION_TTL_SECONDS: "120" })?.initiationTtlSeconds,
      120,
    );
  });

  it("rejects a non-https issuer", () => {
    assert.throws(() => resolveOidcConfig({ ...base, OIDC_ISSUER: "http://insecure" }), /https/);
    assert.throws(() => resolveOidcConfig({ ...base, OIDC_ISSUER: "not-a-url" }), /valid URL/);
  });

  it("rejects a partial configuration once enabled", () => {
    assert.throws(() => resolveOidcConfig({ ...base, OIDC_CLIENT_ID: undefined }), /OIDC_CLIENT_ID/);
    assert.throws(() => resolveOidcConfig({ ...base, OIDC_CLIENT_SECRET: "  " }), /OIDC_CLIENT_SECRET/);
    assert.throws(() => resolveOidcConfig({ ...base, OIDC_REDIRECT_URI: undefined }), /OIDC_REDIRECT_URI/);
  });

  it("rejects a non-UUID tenant id", () => {
    assert.throws(() => resolveOidcConfig({ ...base, OIDC_TENANT_ID: "tenant-a" }), /UUID/);
  });
});
