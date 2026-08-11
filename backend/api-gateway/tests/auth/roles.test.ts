import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { resolveExplicitRolesMode } from "../../src/auth/explicit-roles-mode";
import {
  applyExplicitRolesModeFromEnv,
  canActAsAgent,
  canListFindings,
  canManageAgents,
  canManageFindings,
  canQueryTelemetry,
  canReadAlerts,
  canReadAuditLogs,
  canReadTenantSelf,
  configureExplicitRolesMode,
  getExplicitRolesMode,
  implicitOperatorCompatWarnMapSize,
  isAuditorOnlyPrincipal,
  isOperatorPrincipal,
  normalizeDeppRoles,
  resetImplicitOperatorCompatWarnState,
} from "../../src/auth/roles";

afterEach(() => {
  configureExplicitRolesMode("compat");
  resetImplicitOperatorCompatWarnState();
});

describe("resolveExplicitRolesMode", () => {
  it("defaults unset/empty to compat and rejects invalid values", () => {
    assert.equal(resolveExplicitRolesMode(undefined), "compat");
    assert.equal(resolveExplicitRolesMode(""), "compat");
    assert.equal(resolveExplicitRolesMode("  enforce "), "enforce");
    assert.throws(
      () => resolveExplicitRolesMode("strict"),
      /AUTH_EXPLICIT_ROLES_MODE/,
    );
  });

  it("requires an explicit value when requireExplicit (AUTH_MODE=jwt)", () => {
    assert.throws(
      () => resolveExplicitRolesMode(undefined, { requireExplicit: true }),
      /must be set explicitly when AUTH_MODE=jwt/,
    );
    assert.throws(
      () => resolveExplicitRolesMode("  ", { requireExplicit: true }),
      /must be set explicitly when AUTH_MODE=jwt/,
    );
    assert.equal(
      resolveExplicitRolesMode("compat", { requireExplicit: true }),
      "compat",
    );
    assert.equal(
      resolveExplicitRolesMode("enforce", { requireExplicit: true }),
      "enforce",
    );
  });
});

describe("applyExplicitRolesModeFromEnv", () => {
  it("configures the module mode used by authorization helpers", () => {
    assert.equal(
      applyExplicitRolesModeFromEnv("enforce"),
      "enforce",
    );
    assert.equal(getExplicitRolesMode(), "enforce");
    assert.equal(applyExplicitRolesModeFromEnv(undefined), "compat");
    assert.equal(getExplicitRolesMode(), "compat");
  });
});

describe("normalizeDeppRoles", () => {
  it("allow-lists operator and auditor from arrays and CSV", () => {
    assert.deepEqual(normalizeDeppRoles(["auditor", "operator", "admin"]), [
      "auditor",
      "operator",
    ]);
    assert.deepEqual(normalizeDeppRoles("auditor, unknown,operator"), [
      "auditor",
      "operator",
    ]);
    assert.equal(normalizeDeppRoles(["admin"]), undefined);
  });

  it("dedupes, trims, lower-cases, and treats malformed / empty as missing", () => {
    assert.deepEqual(normalizeDeppRoles([" Operator ", "OPERATOR", "auditor"]), [
      "operator",
      "auditor",
    ]);
    assert.equal(normalizeDeppRoles([]), undefined);
    assert.equal(normalizeDeppRoles(""), undefined);
    assert.equal(normalizeDeppRoles("  ,  "), undefined);
    assert.equal(normalizeDeppRoles(undefined), undefined);
    assert.equal(normalizeDeppRoles(null), undefined);
    assert.equal(normalizeDeppRoles(42), undefined);
    assert.equal(normalizeDeppRoles({ roles: ["operator"] }), undefined);
    assert.deepEqual(
      normalizeDeppRoles(["operator", 1, null, "auditor"] as unknown),
      ["operator", "auditor"],
    );
  });
});

describe("principal role helpers (compat)", () => {
  const tenantId = "11111111-1111-4111-8111-111111111111";

  it("treats humans without roles as operators in compat", () => {
    configureExplicitRolesMode("compat");
    const p = { tenantId };
    assert.equal(isOperatorPrincipal(p), true);
    assert.equal(canReadAuditLogs(p), true);
    assert.equal(canManageAgents(p), true);
    assert.equal(canQueryTelemetry(p), true);
    assert.equal(canListFindings(p), true);
    assert.equal(canManageFindings(p), true);
    assert.equal(canReadTenantSelf(p), true);
    assert.equal(isAuditorOnlyPrincipal(p), false);
  });

  it("allows auditor-only tenant self / audit-capability but not findings or agents/telemetry query", () => {
    const p = { tenantId, roles: ["auditor"] as const };
    assert.equal(isOperatorPrincipal(p), false);
    assert.equal(isAuditorOnlyPrincipal(p), true);
    assert.equal(canReadAuditLogs(p), true);
    assert.equal(canReadTenantSelf(p), true);
    assert.equal(canReadAlerts(p), true);
    assert.equal(canManageAgents(p), false);
    assert.equal(canQueryTelemetry(p), false);
    assert.equal(canListFindings(p), false);
    assert.equal(canManageFindings(p), false);
  });

  it("lets operator+auditor manage agents, findings, telemetry query, and tenant self", () => {
    const p = { tenantId, roles: ["auditor", "operator"] as const };
    assert.equal(isOperatorPrincipal(p), true);
    assert.equal(isAuditorOnlyPrincipal(p), false);
    assert.equal(canManageAgents(p), true);
    assert.equal(canReadAuditLogs(p), true);
    assert.equal(canQueryTelemetry(p), true);
    assert.equal(canListFindings(p), true);
    assert.equal(canManageFindings(p), true);
    assert.equal(canReadTenantSelf(p), true);
  });

  it("denies agents for audit/tenant-self/manage but allows telemetry query and findings list", () => {
    const agent = {
      tenantId,
      agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    };
    assert.equal(canActAsAgent(agent), true);
    assert.equal(canReadAuditLogs(agent), false);
    assert.equal(canManageAgents(agent), false);
    assert.equal(canQueryTelemetry(agent), true);
    assert.equal(canListFindings(agent), true);
    assert.equal(canManageFindings(agent), false);
    assert.equal(canReadAlerts(agent), false);
    assert.equal(canReadTenantSelf(agent), false);
  });

  it("treats only non-empty agentId as canActAsAgent (mode-independent)", () => {
    configureExplicitRolesMode("enforce");
    assert.equal(canActAsAgent({ tenantId }), false);
    assert.equal(canActAsAgent({ tenantId, roles: ["operator"] }), false);
    assert.equal(canActAsAgent({ tenantId, agentId: "  " }), false);
    assert.equal(
      canActAsAgent({
        tenantId,
        agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
      true,
    );
    configureExplicitRolesMode("compat");
    assert.equal(canActAsAgent({ tenantId, roles: ["auditor"] }), false);
  });
});

describe("principal role helpers (enforce)", () => {
  const tenantId = "11111111-1111-4111-8111-111111111111";

  it("denies missing, empty, and unsupported-only roles consistently", () => {
    configureExplicitRolesMode("enforce");
    const cases = [
      { tenantId },
      { tenantId, roles: [] as const },
      { tenantId, roles: [] as readonly string[] },
    ];
    for (const p of cases) {
      assert.equal(isOperatorPrincipal(p), false, JSON.stringify(p));
      assert.equal(canManageAgents(p), false, JSON.stringify(p));
      assert.equal(canReadAuditLogs(p), false, JSON.stringify(p));
      assert.equal(canQueryTelemetry(p), false, JSON.stringify(p));
      assert.equal(canListFindings(p), false, JSON.stringify(p));
      assert.equal(canManageFindings(p), false, JSON.stringify(p));
      assert.equal(canReadTenantSelf(p), false, JSON.stringify(p));
    }
  });

  it("allows explicit operator findings/agents/telemetry; auditor cannot manage them but can read tenant self", () => {
    configureExplicitRolesMode("enforce");
    const op = { tenantId, roles: ["operator"] as const };
    assert.equal(canManageAgents(op), true);
    assert.equal(canReadAuditLogs(op), true);
    assert.equal(canQueryTelemetry(op), true);
    assert.equal(canListFindings(op), true);
    assert.equal(canManageFindings(op), true);
    assert.equal(canReadTenantSelf(op), true);

    const aud = { tenantId, roles: ["auditor"] as const };
    assert.equal(canManageAgents(aud), false);
    assert.equal(canReadAuditLogs(aud), true);
    assert.equal(canQueryTelemetry(aud), false);
    assert.equal(canListFindings(aud), false);
    assert.equal(canManageFindings(aud), false);
    assert.equal(canReadTenantSelf(aud), true);
  });
});

describe("compat implicit-operator warning rate limit", () => {
  const tenantId = "11111111-1111-4111-8111-111111111111";
  const userId = "22222222-2222-4222-8222-222222222222";

  it("records at most one entry per subject+tenant within the window", () => {
    configureExplicitRolesMode("compat");
    resetImplicitOperatorCompatWarnState();
    const p = { tenantId, userId };
    assert.equal(isOperatorPrincipal(p), true);
    assert.equal(implicitOperatorCompatWarnMapSize(), 1);
    assert.equal(isOperatorPrincipal(p), true);
    assert.equal(implicitOperatorCompatWarnMapSize(), 1);
    assert.equal(
      isOperatorPrincipal({
        tenantId,
        userId: "33333333-3333-4333-8333-333333333333",
      }),
      true,
    );
    assert.equal(implicitOperatorCompatWarnMapSize(), 2);
  });
});
