import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  issueAccessToken,
  type JwtConfig,
} from "../../src/auth/jwt/access-token";
import {
  applyExplicitRolesModeFromEnv,
  configureExplicitRolesMode,
  getExplicitRolesMode,
  resetImplicitOperatorCompatWarnState,
} from "../../src/auth/roles";
import { createJwtStrategy } from "../../src/auth/strategies/jwt";
import type { CorrelationService } from "../../src/correlation/service";
import { resolveExplicitRolesMode } from "../../src/auth/explicit-roles-mode";
import { startTestServer } from "../helpers/test-server";

/**
 * Proves AUTH_EXPLICIT_ROLES_MODE reaches authorization helpers through the
 * same applyExplicitRolesModeFromEnv path used by config/env.ts at startup.
 */

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";

const JWT_CONFIG: JwtConfig = {
  secret: "startup-explicit-roles-secret-xxxxxxx",
  issuer: "depp",
  audience: "depp-api",
  accessTtlSeconds: 900,
};

afterEach(() => {
  configureExplicitRolesMode("compat");
  resetImplicitOperatorCompatWarnState();
});

function stubCorrelation(): CorrelationService {
  return {
    evaluateAfterIngest: async () => undefined,
    evaluateSilence: async () => ({
      evaluated: 0,
      created: 0,
      suppressed: 0,
    }),
    updateStatus: async () => ({ ok: false, reason: "not_found" }),
    patchFinding: async () => ({ ok: false, reason: "not_found" }),
    createSuppression: async () => ({ ok: false, reason: "conflict" }),
    clearSuppression: async () => ({ ok: false, reason: "not_found" }),
    listSuppressions: async () => [],
    list: async () => [],
    dashboard: async () => ({
      generatedAt: new Date("2026-03-01T12:00:00.000Z"),
      windowHours: 24,
      countsByStatus: { open: 0, acknowledged: 0, resolved: 0 },
      countsByRuleId: {
        "agent.lifecycle_churn": 0,
        "agent.heartbeat_burst": 0,
        "agent.heartbeat_silence": 0,
      },
      recentCreatedCount: 0,
      recentChangedCount: 0,
      activeSuppressionCount: 0,
    }),
    attention: async () => ({
      generatedAt: new Date("2026-03-01T12:00:00.000Z"),
      since: new Date("2026-02-28T12:00:00.000Z"),
      maxLookbackHours: 24,
      openCount: 0,
      activeSuppressionCount: 0,
      items: [],
      truncated: false,
    }),
  };
}

describe("startup-driven AUTH_EXPLICIT_ROLES_MODE", () => {
  it("enforce via applyExplicitRolesModeFromEnv denies roleless JWT on findings; operator allowed", async () => {
    // Mirrors config/env.ts: resolve + configure before createApp/listen.
    applyExplicitRolesModeFromEnv(process.env.AUTH_EXPLICIT_ROLES_MODE_TEST ?? "enforce");
    assert.equal(getExplicitRolesMode(), "enforce");

    const server = await startTestServer({
      authStrategy: createJwtStrategy(JWT_CONFIG),
      correlationService: stubCorrelation(),
    });

    try {
      const roleless = issueAccessToken(JWT_CONFIG, {
        tenantId: TENANT_ID,
        userId: USER_ID,
        sessionId: SESSION_ID,
      });
      const operator = issueAccessToken(JWT_CONFIG, {
        tenantId: TENANT_ID,
        userId: USER_ID,
        sessionId: SESSION_ID,
        roles: ["operator"],
      });

      const denied = await fetch(`${server.url}/v1/findings`, {
        headers: { authorization: `Bearer ${roleless}` },
      });
      assert.equal(denied.status, 403);
      assert.equal((await denied.json()).error.code, "FINDINGS_REJECTED");

      const allowed = await fetch(`${server.url}/v1/findings`, {
        headers: { authorization: `Bearer ${operator}` },
      });
      assert.equal(allowed.status, 200);
    } finally {
      await server.close();
    }
  });

  it("invalid AUTH_EXPLICIT_ROLES_MODE fails closed before requests (config parse)", () => {
    assert.throws(
      () => resolveExplicitRolesMode("not-a-mode"),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /Invalid AUTH_EXPLICIT_ROLES_MODE/);
        assert.equal(err.message.includes("secret"), false);
        assert.equal(err.message.includes("password"), false);
        return true;
      },
    );
    assert.throws(
      () => applyExplicitRolesModeFromEnv("bogus"),
      /Invalid AUTH_EXPLICIT_ROLES_MODE/,
    );
    // Failed apply must not leave a partial enforce state from this call;
    // previous afterEach / prior success leaves compat until a successful apply.
    assert.equal(getExplicitRolesMode(), "compat");
  });

  it("AUTH_MODE=jwt requires explicit AUTH_EXPLICIT_ROLES_MODE (not NODE_ENV)", () => {
    assert.throws(
      () =>
        applyExplicitRolesModeFromEnv(undefined, { requireExplicit: true }),
      /must be set explicitly when AUTH_MODE=jwt/,
    );
    assert.equal(
      applyExplicitRolesModeFromEnv("compat", { requireExplicit: true }),
      "compat",
    );
  });
});
