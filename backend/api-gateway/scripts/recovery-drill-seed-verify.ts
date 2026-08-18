/**
 * Seed and post-restore verifier for the local disposable-Postgres recovery drill.
 *
 * Modes:
 *   --seed    Create vertical-slice dataset via app services; write state JSON.
 *   --verify  Assert restored data satisfies criteria 1–6 (HTTP + depp_app).
 *
 * Local evidence only. Does not print connection strings, tokens, or passwords.
 *
 * Env:
 *   RECOVERY_STATE_PATH  Absolute path to state JSON (outside the repo).
 *   DATABASE_URL / DATABASE_MIGRATION_URL  Point at source (seed) or restored DB (verify).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  AUTH_FAILURE_BURST_RULE_ID,
  AUTH_FAILURE_BURST_THRESHOLD,
  floorToAuthFailureWindowBucket,
} from "../src/alerts/rule";
import { createAlertsRepository } from "../src/alerts/repository";
import { createAlertsService } from "../src/alerts/service";
import {
  issueAccessToken,
  issueAgentAccessToken,
  type JwtConfig,
} from "../src/auth/jwt/access-token";
import {
  applyExplicitRolesModeFromEnv,
  configureExplicitRolesMode,
  resetImplicitOperatorCompatWarnState,
} from "../src/auth/roles";
import { createJwtStrategy } from "../src/auth/strategies/jwt";
import { withTenantTransaction } from "../src/db/tenant-context";
import { createTelemetryRepository } from "../src/telemetry/repository";
import { createTelemetryService } from "../src/telemetry/service";
import { startTestServer, type TestServer } from "../tests/helpers/test-server";
import {
  connectDb,
  resetSchema,
  seedTenant,
  type DbHandles,
} from "../tests/db/helpers";

const JWT_CONFIG: JwtConfig = {
  secret: "recovery-drill-local-test-secret-xx",
  issuer: "depp",
  audience: "depp-api",
  accessTtlSeconds: 900,
};

const USER_A = "22222222-2222-4222-8222-222222222221";
const USER_B = "22222222-2222-4222-8222-222222222222";
const SESSION_A = "33333333-3333-4333-8333-333333333331";
const SESSION_B = "33333333-3333-4333-8333-333333333332";

const LEAK_MARKERS = [
  "postgres://",
  "depp_app_local_dev_only",
  "depp_migrator_local_dev_only",
  "recovery-drill-local-test-secret",
  "ECONNREFUSED",
  "password authentication failed",
  "at Object.",
  "node_modules",
] as const;

interface RecoveryState {
  readonly tenantA: string;
  readonly tenantB: string;
  readonly agentA: string;
  readonly alertId: string;
  readonly auditId: string;
  readonly ruleId: string;
}

function statePath(): string {
  const p = process.env.RECOVERY_STATE_PATH;
  if (!p || p.trim() === "") {
    throw new Error("RECOVERY_STATE_PATH is required");
  }
  return path.resolve(p);
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
}

function bucketBase(): Date {
  return floorToAuthFailureWindowBucket(new Date());
}

async function withServer(
  db: DbHandles,
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

async function ingestBurst(
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
    assertSafeEnvelope(raw, `seed ingest #${i}`);
    assert.equal(res.status, 201, `seed ingest #${i} must succeed`);
  }
}

async function seed(): Promise<void> {
  applyExplicitRolesModeFromEnv("enforce");
  const db = await connectDb();
  try {
    await resetSchema(db.migrator);
    const tenantA = await seedTenant(db.migrator, "recovery-tenant-a");
    const tenantB = await seedTenant(db.migrator, "recovery-tenant-b");

    const insertedA = await withTenantTransaction(db.app, tenantA, (trx) =>
      trx
        .insertInto("agents")
        .values({ tenant_id: tenantA, name: "recovery-agent-a" })
        .returning("id")
        .executeTakeFirstOrThrow(),
    );
    await withTenantTransaction(db.app, tenantB, (trx) =>
      trx
        .insertInto("agents")
        .values({ tenant_id: tenantB, name: "recovery-agent-b" })
        .returning("id")
        .executeTakeFirstOrThrow(),
    );
    const agentA = insertedA.id;

    await withServer(db, async (server) => {
      await ingestBurst(server, tenantA, agentA);
    });

    const alertsRepo = createAlertsRepository(db.app);
    const alerts = await alertsRepo.listAlerts(tenantA);
    assert.equal(alerts.length, 1, "seed must create exactly one Tenant A alert");
    const alertId = alerts[0].id;
    const audit = await alertsRepo.listAuditForAlert(tenantA, alertId);
    assert.equal(audit.length, 1, "seed must create alert_created audit");
    assert.equal(audit[0].tenantId, tenantA);
    assert.equal(audit[0].eventType, "alert_created");

    const state: RecoveryState = {
      tenantA,
      tenantB,
      agentA,
      alertId,
      auditId: audit[0].id,
      ruleId: AUTH_FAILURE_BURST_RULE_ID,
    };

    const out = statePath();
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(state, null, 2), "utf8");
    console.log("recovery-drill seed: ok (state written; identifiers only)");
  } finally {
    configureExplicitRolesMode("compat");
    resetImplicitOperatorCompatWarnState();
    await db.close();
  }
}

async function verify(): Promise<void> {
  applyExplicitRolesModeFromEnv("enforce");
  const state = JSON.parse(fs.readFileSync(statePath(), "utf8")) as RecoveryState;
  const db = await connectDb();

  try {
    const alertsRepo = createAlertsRepository(db.app);

    // c6 + c4: restored Tenant A alert + tenant-bound audit; Tenant B empty.
    const alertsA = await alertsRepo.listAlerts(state.tenantA);
    assert.equal(alertsA.length, 1);
    assert.equal(alertsA[0].id, state.alertId);
    assert.equal(alertsA[0].agentId, state.agentA);
    assert.equal(alertsA[0].ruleId, state.ruleId);

    const alertsB = await alertsRepo.listAlerts(state.tenantB);
    assert.equal(alertsB.length, 0);

    const auditA = await alertsRepo.listAuditForAlert(
      state.tenantA,
      state.alertId,
    );
    assert.equal(auditA.length, 1);
    assert.equal(auditA[0].id, state.auditId);
    assert.equal(auditA[0].tenantId, state.tenantA);
    assert.equal(auditA[0].alertId, state.alertId);
    assert.equal(auditA[0].eventType, "alert_created");
    assert.equal(auditA[0].actorKind, "system");
    assert.equal(auditA[0].actorId, AUTH_FAILURE_BURST_RULE_ID);

    const auditB = await alertsRepo.listAuditForAlert(
      state.tenantB,
      state.alertId,
    );
    assert.equal(auditB.length, 0);

    // c5: depp_app cannot UPDATE/DELETE restored audit rows.
    await assert.rejects(
      () =>
        withTenantTransaction(db.app, state.tenantA, (trx) =>
          trx
            .updateTable("alert_audit_events")
            .set({ event_type: "tampered" })
            .where("id", "=", state.auditId)
            .execute(),
        ),
      () => true,
    );
    await assert.rejects(
      () =>
        withTenantTransaction(db.app, state.tenantA, (trx) =>
          trx
            .deleteFrom("alert_audit_events")
            .where("id", "=", state.auditId)
            .execute(),
        ),
      () => true,
    );
    const still = await alertsRepo.listAuditForAlert(
      state.tenantA,
      state.alertId,
    );
    assert.equal(still.length, 1);
    assert.equal(still[0].eventType, "alert_created");

    // c1–c3 + c2 via real HTTP against restored DB.
    await withServer(db, async (server) => {
      const opA = humanBearer(state.tenantA, USER_A, SESSION_A, ["operator"]);
      const opB = humanBearer(state.tenantB, USER_B, SESSION_B, ["operator"]);

      const listA = await fetch(`${server.url}/v1/alerts`, {
        headers: { authorization: opA },
      });
      const listARaw = await listA.text();
      assertSafeEnvelope(listARaw, "post-restore tenant A list");
      assert.equal(listA.status, 200);
      const listABody = JSON.parse(listARaw) as {
        data: { alerts: Array<{ id: string }> };
      };
      assert.equal(listABody.data.alerts.length, 1);
      assert.equal(listABody.data.alerts[0].id, state.alertId);

      const detail = await fetch(`${server.url}/v1/alerts/${state.alertId}`, {
        headers: { authorization: opA },
      });
      const detailRaw = await detail.text();
      assertSafeEnvelope(detailRaw, "post-restore allowed detail");
      assert.equal(detail.status, 200);

      const listB = await fetch(`${server.url}/v1/alerts`, {
        headers: { authorization: opB },
      });
      assert.equal(listB.status, 200);
      assert.equal((await listB.json()).data.alerts.length, 0);

      const cross = await fetch(`${server.url}/v1/alerts/${state.alertId}`, {
        headers: { authorization: opB },
      });
      const crossRaw = await cross.text();
      assertSafeEnvelope(crossRaw, "post-restore cross-tenant deny");
      assert.equal(cross.status, 404);
      assert.equal(JSON.parse(crossRaw).error.code, "ALERTS_NOT_FOUND");
      assert.equal(crossRaw.includes(state.alertId), false);
      assert.equal(crossRaw.includes(state.tenantA), false);

      const agentDeny = await fetch(`${server.url}/v1/alerts`, {
        headers: { authorization: agentBearer(state.tenantA, state.agentA) },
      });
      const agentRaw = await agentDeny.text();
      assertSafeEnvelope(agentRaw, "post-restore agent RBAC deny");
      assert.equal(agentDeny.status, 403);
      assert.equal(JSON.parse(agentRaw).error.code, "ALERTS_REJECTED");
    });

    console.log(
      "recovery-drill verify: ok (c1–c6 on restored disposable DB; local only)",
    );
  } finally {
    configureExplicitRolesMode("compat");
    resetImplicitOperatorCompatWarnState();
    await db.close();
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === "--seed") {
    await seed();
    return;
  }
  if (mode === "--verify") {
    await verify();
    return;
  }
  throw new Error("usage: recovery-drill-seed-verify.ts --seed|--verify");
}

main().catch((err) => {
  const name = err instanceof Error ? err.name : "Error";
  console.error(`recovery-drill seed/verify failed: ${name}`);
  process.exit(1);
});
