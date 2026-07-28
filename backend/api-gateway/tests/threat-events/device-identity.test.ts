import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDeviceIdentityService } from "../../src/threat-events/device-identity";
import type {
  DeviceIdentityRepository,
  DeviceIdentityRow,
} from "../../src/threat-events/device-identity-repository";
import { generateEd25519KeyPairForTests } from "../../src/threat-events/signature";

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const agentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("DeviceIdentityService.bindForAgent", () => {
  it("creates an active identity for a valid key", async () => {
    const { publicKeyEd25519 } = generateEd25519KeyPairForTests();
    const rows = new Map<string, DeviceIdentityRow>();

    const repo: DeviceIdentityRepository = {
      async findByAgentId(_tid, aid) {
        return rows.get(aid);
      },
      async findById() {
        return undefined;
      },
      async insert(_tid, input) {
        const row: DeviceIdentityRow = {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          tenantId,
          agentId: input.agentId,
          publicKeyEd25519: input.publicKeyEd25519,
          deviceCertPem: null,
          status: input.status ?? "active",
          createdAt: new Date("2026-03-01T12:00:00.000Z"),
          revokedAt: null,
        };
        rows.set(input.agentId, row);
        return row;
      },
      async revoke() {
        return undefined;
      },
    };

    const service = createDeviceIdentityService({ deviceIdentities: repo });
    const outcome = await service.bindForAgent(
      tenantId,
      agentId,
      publicKeyEd25519,
    );
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.status, "created");
      assert.equal(outcome.identity.status, "active");
    }
  });

  it("is idempotent for the same key and conflicts on a different key", async () => {
    const first = generateEd25519KeyPairForTests();
    const second = generateEd25519KeyPairForTests();
    const existing: DeviceIdentityRow = {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      tenantId,
      agentId,
      publicKeyEd25519: first.publicKeyEd25519,
      deviceCertPem: null,
      status: "active",
      createdAt: new Date(),
      revokedAt: null,
    };

    const repo: DeviceIdentityRepository = {
      async findByAgentId() {
        return existing;
      },
      async findById() {
        return undefined;
      },
      async insert() {
        throw new Error("should not insert");
      },
      async revoke() {
        return undefined;
      },
    };

    const service = createDeviceIdentityService({ deviceIdentities: repo });
    const again = await service.bindForAgent(
      tenantId,
      agentId,
      first.publicKeyEd25519,
    );
    assert.equal(again.ok, true);
    if (again.ok) {
      assert.equal(again.status, "idempotent");
    }

    const conflict = await service.bindForAgent(
      tenantId,
      agentId,
      second.publicKeyEd25519,
    );
    assert.equal(conflict.ok, false);
    if (!conflict.ok) {
      assert.equal(conflict.reason, "conflict");
    }
  });

  it("fails closed on revoked and malformed keys", async () => {
    const { publicKeyEd25519 } = generateEd25519KeyPairForTests();
    const revoked: DeviceIdentityRow = {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      tenantId,
      agentId,
      publicKeyEd25519,
      deviceCertPem: null,
      status: "revoked",
      createdAt: new Date(),
      revokedAt: new Date(),
    };

    const service = createDeviceIdentityService({
      deviceIdentities: {
        async findByAgentId() {
          return revoked;
        },
        async findById() {
          return undefined;
        },
        async insert() {
          throw new Error("not used");
        },
        async revoke() {
          return undefined;
        },
      },
    });

    const outcome = await service.bindForAgent(
      tenantId,
      agentId,
      publicKeyEd25519,
    );
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.reason, "revoked");
    }

    const bad = await service.bindForAgent(tenantId, agentId, "nope");
    assert.equal(bad.ok, false);
    if (!bad.ok) {
      assert.equal(bad.reason, "malformed_key");
    }
  });
});
