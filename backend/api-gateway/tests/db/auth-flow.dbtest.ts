import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { type JwtConfig, verifyAccessToken } from "../../src/auth/jwt/access-token";
import { createAuthService } from "../../src/auth/service";
import { withTenantTransaction } from "../../src/db/tenant-context";
import { createSessionsRepository } from "../../src/sessions/repository";
import { createUsersRepository } from "../../src/users/repository";
import { connectDb, resetSchema, seedTenant, type DbHandles } from "./helpers";

const JWT: JwtConfig = {
  secret: "test-secret-that-is-long-enough-to-pass",
  issuer: "depp",
  audience: "depp-api",
  accessTtlSeconds: 900,
};

const IDENTITY = {
  issuer: "https://idp.example.com",
  subject: "auth0|user-123",
  email: "alice@example.com",
  displayName: "Alice",
};

let db: DbHandles;
let tenantA: string;
let tenantB: string;

function service(handles: DbHandles) {
  return createAuthService({
    users: createUsersRepository(handles.app),
    sessions: createSessionsRepository(handles.app),
    jwtConfig: JWT,
  });
}

before(async () => {
  db = await connectDb();
});

after(async () => {
  if (db) {
    await db.close();
  }
});

beforeEach(async () => {
  await resetSchema(db.migrator);
  tenantA = await seedTenant(db.migrator, "tenant-a");
  tenantB = await seedTenant(db.migrator, "tenant-b");
});

describe("auth flow over the real database", () => {
  it("completes login and anchors the access token to tenant/user/session", async () => {
    const tokens = await service(db).completeOidcLogin(tenantA, IDENTITY);

    const claims = verifyAccessToken(JWT, tokens.accessToken);
    assert.equal(claims.kind, "human");
    if (claims.kind !== "human") return;
    assert.equal(claims.tenantId, tenantA);
    assert.ok(claims.userId);
    assert.ok(claims.sessionId);
    assert.ok(tokens.refreshToken.length > 0);

    // The session row exists for that user, in that tenant.
    const sessions = await withTenantTransaction(db.app, tenantA, (trx) =>
      trx.selectFrom("sessions").selectAll().execute(),
    );
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, claims.sessionId);
    assert.equal(sessions[0].user_id, claims.userId);
  });

  it("refreshes: new access token and a rotated refresh token", async () => {
    const svc = service(db);
    const login = await svc.completeOidcLogin(tenantA, IDENTITY);

    const refreshed = await svc.refresh(tenantA, login.refreshToken);

    assert.equal(refreshed.ok, true);
    if (refreshed.ok) {
      assert.notEqual(refreshed.tokens.refreshToken, login.refreshToken);
      const claims = verifyAccessToken(JWT, refreshed.tokens.accessToken);
      assert.equal(claims.kind, "human");
      assert.equal(claims.tenantId, tenantA);
    }
  });

  it("rejects replay of a consumed refresh token through the service path", async () => {
    const svc = service(db);
    const login = await svc.completeOidcLogin(tenantA, IDENTITY);

    await svc.refresh(tenantA, login.refreshToken); // consumes it
    const replay = await svc.refresh(tenantA, login.refreshToken);

    assert.deepEqual(replay, { ok: false, reason: "replayed" });
  });

  it("rejects refresh for a revoked session through the service path", async () => {
    const svc = service(db);
    const sessions = createSessionsRepository(db.app);
    const login = await svc.completeOidcLogin(tenantA, IDENTITY);
    const verified = verifyAccessToken(JWT, login.accessToken);
    assert.equal(verified.kind, "human");
    if (verified.kind !== "human") return;
    const { sessionId } = verified;

    assert.equal(await sessions.revokeSession(tenantA, sessionId), true);

    const result = await svc.refresh(tenantA, login.refreshToken);
    assert.deepEqual(result, { ok: false, reason: "session_revoked" });
  });

  it("does not honour a refresh token under a different tenant", async () => {
    const login = await service(db).completeOidcLogin(tenantA, IDENTITY);

    const crossTenant = await service(db).refresh(tenantB, login.refreshToken);
    assert.deepEqual(crossTenant, { ok: false, reason: "invalid" });
  });
});
