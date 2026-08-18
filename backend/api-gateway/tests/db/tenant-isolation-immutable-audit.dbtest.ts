import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";

import {
  AUTH_FAILURE_BURST_RULE_ID,
  AUTH_FAILURE_BURST_THRESHOLD,
  floorToAuthFailureWindowBucket,
} from "../../src/alerts/rule";
import { createAlertsRepository } from "../../src/alerts/repository";
import { createAlertsService } from "../../src/alerts/service";
import {
  issueAccessToken,
  issueAgentAccessToken,
  type JwtConfig,
} from "../../src/auth/jwt/access-token";
import {
  applyExplicitRolesModeFromEnv,
  configureExplicitRolesMode,
  resetImplicitOperatorCompatWarnState,
} from "../../src/auth/roles";
import { createJwtStrategy } from "../../src/auth/strategies/jwt";
import { withTenantTransaction } from "../../src/db/tenant-context";
import { createTelemetryRepository } from "../../src/telemetry/repository";
import { createTelemetryService } from "../../src/telemetry/service";
import { startTestServer, type TestServer } from "../helpers/test-server";
import { connectDb, resetSchema, seedTenant, type DbHandles } from "./helpers";

/**
 * Local disposable-Postgres vertical-slice gate (criteria 1–6 only).
 *
 * Proves tenant-isolated authorization + immutable alert audit through real
 * api-gateway routes and the app-role DB connection used by `npm run test:db`.
 * Not staging, platform, recovery, IdP, or scan evidence.
 */

const JWT_CONFIG: JwtConfig = {
  secret: "vertical-slice-local-test-secret-xxxx",
  issuer: "depp",
  audience: "depp-api",
  accessTtlSeconds: 900,
};

const USER_A = "22222222-2222-4222-8222-222222222221";
const USER_B = "22222222-2222-4222-8222-222222222222";
const SESSION_A = "33333333-3333-4333-8333-333333333331";
const SESSION_B = "33333333-3333-4333-8333-333333333332";

/** Markers that must never appear in HTTP bodies (do not print DATABASE_URL). */
const LEAK_MARKERS = [
  "postgres://",
  "depp_app_local_dev_only",
  "depp_migrator_local_dev_only",
  "vertical-slice-local-test-secret",
  "ECONNREFUSED",
  "password authentication failed",
  "at Object.",
  "node_modules",
] as const;

let db: DbHandles;
let tenantA: string;
let tenantB: string;
let agentA: string;
let agentB: string;

before(async () => {
  db = await connectDb();
});

after(async () => {
  if (db) {
    await db.close();
  }
});

beforeEach(async () => {
  applyExplicitRolesModeFromEnv("enforce");
  await resetSchema(db.migrator);
  tenantA = await seedTenant(db.migrator, "tenant-a");
  tenantB = await seedTenant(db.migrator, "tenant-b");

  const insertedA = await withTenantTransaction(db.app, tenantA, (trx) =>
    trx
      .insertInto("agents")
      .values({ tenant_id: tenantA, name: "agent-a" })
      .returning("id")
      .executeTakeFirstOrThrow(),
  );
  const insertedB = await withTenantTransaction(db.app, tenantB, (trx) =>
    trx
      .insertInto("agents")
      .values({ tenant_id: tenantB, name: "agent-b" })
      .returning("id")
      .executeTakeFirstOrThrow(),
  );
  agentA = insertedA.id;
  agentB = insertedB.id;
});

afterEach(() => {
  configureExplicitRolesMode("compat");
  resetImplicitOperatorCompatWarnState();
});

/** Floor "now" into the auth-failure 5m bucket (HTTP contract: max 7d past). */
function bucketBase(): Date {
  return floorToAuthFailureWindowBucket(new Date());
}

function humanBearer(
  tenantId: string,
  userId: string,
  sessionId: string,
  roles: readonly string[],
): string {
  return `Bearer ${issueAccessToken(JWT_CONFIG, {
    tenantId,
    userId,
    sessionId,
    roles: [...roles],
  })}`;
}

function agentBearer(tenantId: string, agentId: string): string {
  return `Bearer ${issueAgentAccessToken(JWT_CONFIG, { tenantId, agentId })}`;
}

function assertSafeEnvelope(raw: string, context: string): void {
  for (const marker of LEAK_MARKERS) {
    if (raw.includes(marker)) {
      assert.fail(`${context}: response leaked a sensitive fragment`);
    }
  }
  const appUrl = process.env.DATABASE_URL;
  if (appUrl && appUrl.length > 0 && raw.includes(appUrl)) {
    assert.fail(`${context}: response leaked DATABASE_URL`);
  }
}

async function withVerticalServer(
  run: (server: TestServer) => Promise<void>,
): Promise<void> {
  const telemetryRepo = createTelemetryRepository(db.app);
  const alertsRepo = createAlertsRepository(db.app);
  const telemetryService = createTelemetryService({
    telemetry: telemetryRepo,
    authFailureAlerts: alertsRepo,
  });
  const alertsService = createAlertsService({ alerts: alertsRepo });

  const server = await startTestServer({
    authStrategy: createJwtStrategy(JWT_CONFIG),
    telemetryService,
    alertsService,
  });

  try {
    await run(server);
  } finally {
    await server.close();
  }
}

async function ingestAuthFailureBurst(
  server: TestServer,
  tenantId: string,
  agentId: string,
): Promise<void> {
  const base = bucketBase();
  const auth = agentBearer(tenantId, agentId);

  for (let i = 0; i < AUTH_FAILURE_BURST_THRESHOLD; i++) {
    const res = await fetch(`${server.url}/v1/telemetry/events`, {
      method: "POST",
      headers: {
        authorization: auth,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        schemaVersion: 1,
        agentId,
        eventType: "auth_failure",
        occurredAt: new Date(base.getTime() + i * 1000).toISOString(),
        payload: {},
      }),
    });
    const raw = await res.text();
    assertSafeEnvelope(raw, `telemetry ingest #${i}`);
    assert.equal(res.status, 201, `auth_failure ingest #${i} must succeed`);
  }
}

describe("vertical slice: tenant isolation + immutable alert audit (local test:db only)", () => {
  it("c6+c4: agent auth_failure burst creates Tenant-A-only alert and tenant-bound alert_created audit", async () => {
    await withVerticalServer(async (server) => {
      await ingestAuthFailureBurst(server, tenantA, agentA);

      const opA = humanBearer(tenantA, USER_A, SESSION_A, ["operator"]);
      const listA = await fetch(`${server.url}/v1/alerts`, {
        headers: { authorization: opA },
      });
      const listARaw = await listA.text();
      assertSafeEnvelope(listARaw, "tenant A alert list");
      assert.equal(listA.status, 200);
      const listABody = JSON.parse(listARaw) as {
        ok: boolean;
        data: { alerts: Array<{ id: string; agentId: string; ruleId: string }> };
      };
      assert.equal(listABody.ok, true);
      assert.equal(listABody.data.alerts.length, 1);
      assert.equal(listABody.data.alerts[0].agentId, agentA);
      assert.equal(listABody.data.alerts[0].ruleId, AUTH_FAILURE_BURST_RULE_ID);
      const alertId = listABody.data.alerts[0].id;

      const opB = humanBearer(tenantB, USER_B, SESSION_B, ["operator"]);
      const listB = await fetch(`${server.url}/v1/alerts`, {
        headers: { authorization: opB },
      });
      const listBBody = (await listB.json()) as {
        data: { alerts: unknown[] };
      };
      assert.equal(listB.status, 200);
      assert.equal(listBBody.data.alerts.length, 0);

      const alertsRepo = createAlertsRepository(db.app);
      const auditA = await alertsRepo.listAuditForAlert(tenantA, alertId);
      assert.equal(auditA.length, 1);
      assert.equal(auditA[0].tenantId, tenantA);
      assert.equal(auditA[0].alertId, alertId);
      assert.equal(auditA[0].eventType, "alert_created");
      assert.equal(auditA[0].actorKind, "system");
      assert.equal(auditA[0].actorId, AUTH_FAILURE_BURST_RULE_ID);
      assert.equal(
        typeof auditA[0].detail === "object" && auditA[0].detail !== null,
        true,
      );

      const auditB = await alertsRepo.listAuditForAlert(tenantB, alertId);
      assert.equal(auditB.length, 0);
    });
  });

  it("c2: allowed-role operator on Tenant A can read own alert detail", async () => {
    await withVerticalServer(async (server) => {
      await ingestAuthFailureBurst(server, tenantA, agentA);

      const opA = humanBearer(tenantA, USER_A, SESSION_A, ["operator"]);
      const listA = await fetch(`${server.url}/v1/alerts`, {
        headers: { authorization: opA },
      });
      const alertId = (await listA.json()).data.alerts[0].id as string;

      const detail = await fetch(`${server.url}/v1/alerts/${alertId}`, {
        headers: { authorization: opA },
      });
      const raw = await detail.text();
      assertSafeEnvelope(raw, "allowed-role alert detail");
      assert.equal(detail.status, 200);
      const body = JSON.parse(raw) as {
        ok: boolean;
        data: { alert: { id: string; agentId: string } };
      };
      assert.equal(body.ok, true);
      assert.equal(body.data.alert.id, alertId);
      assert.equal(body.data.alert.agentId, agentA);
    });
  });

  it("c1+c3: cross-tenant alert id guess is non-oracular 404 and leak-safe", async () => {
    await withVerticalServer(async (server) => {
      await ingestAuthFailureBurst(server, tenantA, agentA);

      const opA = humanBearer(tenantA, USER_A, SESSION_A, ["operator"]);
      const listA = await fetch(`${server.url}/v1/alerts`, {
        headers: { authorization: opA },
      });
      const alertId = (await listA.json()).data.alerts[0].id as string;

      const opB = humanBearer(tenantB, USER_B, SESSION_B, ["operator"]);
      const cross = await fetch(`${server.url}/v1/alerts/${alertId}`, {
        headers: { authorization: opB },
      });
      const raw = await cross.text();
      assertSafeEnvelope(raw, "cross-tenant alert detail deny");
      assert.equal(cross.status, 404);
      const body = JSON.parse(raw) as {
        ok: boolean;
        error: { code: string; message: string };
      };
      assert.equal(body.ok, false);
      assert.equal(body.error.code, "ALERTS_NOT_FOUND");
      assert.equal(body.error.message, "Alert not found");
      assert.equal(raw.includes(alertId), false);
      assert.equal(raw.includes(tenantA), false);
      assert.equal(raw.includes(agentA), false);
    });
  });

  it("c3: RBAC-denied agent and role-less human get ALERTS_REJECTED without secrets", async () => {
    await withVerticalServer(async (server) => {
      await ingestAuthFailureBurst(server, tenantA, agentA);

      const opA = humanBearer(tenantA, USER_A, SESSION_A, ["operator"]);
      const listA = await fetch(`${server.url}/v1/alerts`, {
        headers: { authorization: opA },
      });
      const alertId = (await listA.json()).data.alerts[0].id as string;

      const agent = await fetch(`${server.url}/v1/alerts`, {
        headers: { authorization: agentBearer(tenantA, agentA) },
      });
      const agentRaw = await agent.text();
      assertSafeEnvelope(agentRaw, "agent RBAC deny list");
      assert.equal(agent.status, 403);
      assert.equal(JSON.parse(agentRaw).error.code, "ALERTS_REJECTED");

      const roleless = await fetch(`${server.url}/v1/alerts/${alertId}`, {
        headers: {
          authorization: humanBearer(tenantA, USER_A, SESSION_A, []),
        },
      });
      const rolelessRaw = await roleless.text();
      assertSafeEnvelope(rolelessRaw, "role-less RBAC deny detail");
      assert.equal(roleless.status, 403);
      assert.equal(JSON.parse(rolelessRaw).error.code, "ALERTS_REJECTED");
      assert.equal(rolelessRaw.includes(alertId), false);
    });
  });

  it("c1: Tenant A agent cannot ingest as Tenant B agent id (reject, no cross-tenant write)", async () => {
    await withVerticalServer(async (server) => {
      const res = await fetch(`${server.url}/v1/telemetry/events`, {
        method: "POST",
        headers: {
          authorization: agentBearer(tenantA, agentA),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          schemaVersion: 1,
          agentId: agentB,
          eventType: "auth_failure",
          occurredAt: bucketBase().toISOString(),
          payload: {},
        }),
      });
      const raw = await res.text();
      assertSafeEnvelope(raw, "cross-agent ingest deny");
      assert.equal(res.status, 400);
      const body = JSON.parse(raw) as { error: { code: string } };
      assert.equal(
        body.error.code === "TELEMETRY_REJECTED" ||
          body.error.code === "TELEMETRY_INVALID",
        true,
      );

      const eventsB = await createTelemetryRepository(db.app).listRecentByTenant(
        tenantB,
      );
      assert.equal(eventsB.length, 0);
      const eventsA = await createTelemetryRepository(db.app).listRecentByTenant(
        tenantA,
      );
      assert.equal(eventsA.length, 0);
    });
  });

  it("c5: depp_app cannot UPDATE or DELETE alert_audit_events (append-only grants)", async () => {
    await withVerticalServer(async (server) => {
      await ingestAuthFailureBurst(server, tenantA, agentA);

      const alertsRepo = createAlertsRepository(db.app);
      const alerts = await alertsRepo.listAlerts(tenantA);
      assert.equal(alerts.length, 1);
      const audit = await alertsRepo.listAuditForAlert(tenantA, alerts[0].id);
      assert.equal(audit.length, 1);
      const auditId = audit[0].id;

      await assert.rejects(
        () =>
          withTenantTransaction(db.app, tenantA, (trx) =>
            trx
              .updateTable("alert_audit_events")
              .set({ event_type: "tampered" })
              .where("id", "=", auditId)
              .execute(),
          ),
        () => true,
      );

      await assert.rejects(
        () =>
          withTenantTransaction(db.app, tenantA, (trx) =>
            trx
              .deleteFrom("alert_audit_events")
              .where("id", "=", auditId)
              .execute(),
          ),
        () => true,
      );

      const still = await alertsRepo.listAuditForAlert(tenantA, alerts[0].id);
      assert.equal(still.length, 1);
      assert.equal(still[0].eventType, "alert_created");
      assert.equal(still[0].tenantId, tenantA);
    });
  });
});
