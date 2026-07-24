import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { hashAgentCredential } from "../../src/agents/credential";
import { createAgentsRepository } from "../../src/agents/repository";
import { createAgentsService } from "../../src/agents/service";
import {
  type JwtConfig,
  verifyAccessToken,
} from "../../src/auth/jwt/access-token";
import { withTenantTransaction } from "../../src/db/tenant-context";
import { connectDb, resetSchema, seedTenant, type DbHandles } from "./helpers";

const JWT: JwtConfig = {
  secret: "test-secret-that-is-long-enough-to-pass",
  issuer: "depp",
  audience: "depp-api",
  accessTtlSeconds: 900,
};

let db: DbHandles;
let tenantA: string;
let tenantB: string;

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

describe("agent enrollment + credential lifecycle (real database)", () => {
  it("registers an agent and stores only the credential hash", async () => {
    const agents = createAgentsRepository(db.app);
    const registered = await agents.register(tenantA, "edge-1");

    assert.ok(registered.credential.length > 0);
    assert.ok(registered.agentId);

    const rows = await withTenantTransaction(db.app, tenantA, (trx) =>
      trx.selectFrom("agent_credentials").selectAll().execute(),
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].agent_id, registered.agentId);
    assert.equal(
      rows[0].credential_hash,
      hashAgentCredential(registered.credential),
    );
    assert.notEqual(rows[0].credential_hash, registered.credential);
    assert.equal(rows[0].revoked_at, null);
  });

  it("exchanges a valid credential for an agent access JWT", async () => {
    const service = createAgentsService({
      agents: createAgentsRepository(db.app),
      jwtConfig: JWT,
    });
    const registered = await service.register(tenantA, "edge-1");

    const exchanged = await service.exchangeForAccessToken(
      tenantA,
      registered.agentId,
      registered.credential,
    );
    assert.equal(exchanged.ok, true);
    if (!exchanged.ok) return;

    const claims = verifyAccessToken(JWT, exchanged.tokens.accessToken);
    assert.deepEqual(claims, {
      kind: "agent",
      tenantId: tenantA,
      agentId: registered.agentId,
    });
  });

  it("rejects wrong credentials and revoked credentials", async () => {
    const service = createAgentsService({
      agents: createAgentsRepository(db.app),
      jwtConfig: JWT,
    });
    const registered = await service.register(tenantA, "edge-1");

    const wrong = await service.exchangeForAccessToken(
      tenantA,
      registered.agentId,
      "not-the-credential",
    );
    assert.deepEqual(wrong, { ok: false, reason: "invalid" });

    assert.equal(
      await service.revokeCredential(tenantA, registered.agentId),
      true,
    );

    const revoked = await service.exchangeForAccessToken(
      tenantA,
      registered.agentId,
      registered.credential,
    );
    assert.deepEqual(revoked, { ok: false, reason: "revoked" });
  });

  it("isolates agents and credentials by tenant", async () => {
    const agents = createAgentsRepository(db.app);
    const a = await agents.register(tenantA, "a-1");
    await agents.register(tenantB, "b-1");

    const cross = await agents.exchangeCredential(
      tenantB,
      a.agentId,
      a.credential,
    );
    assert.deepEqual(cross, { ok: false, reason: "invalid" });

    const seenByB = await withTenantTransaction(db.app, tenantB, (trx) =>
      trx.selectFrom("agents").selectAll().execute(),
    );
    assert.equal(seenByB.length, 1);
    assert.equal(seenByB[0].name, "b-1");
  });
});
