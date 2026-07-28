import type { Kysely } from "kysely";

import type { Database } from "../db/schema";
import { withTenantTransaction } from "../db/tenant-context";

export type DeviceIdentityStatus = "pending" | "active" | "revoked";

export interface DeviceIdentityRow {
  id: string;
  tenantId: string;
  agentId: string;
  publicKeyEd25519: string;
  deviceCertPem: string | null;
  status: DeviceIdentityStatus;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface DeviceIdentityInsert {
  agentId: string;
  publicKeyEd25519: string;
  deviceCertPem?: string | null;
  status?: DeviceIdentityStatus;
}

export interface DeviceIdentityRepository {
  findByAgentId(
    tenantId: string,
    agentId: string,
  ): Promise<DeviceIdentityRow | undefined>;

  findById(
    tenantId: string,
    id: string,
  ): Promise<DeviceIdentityRow | undefined>;

  insert(
    tenantId: string,
    input: DeviceIdentityInsert,
  ): Promise<DeviceIdentityRow>;

  /**
   * Marks an identity revoked. Returns undefined when not found or already
   * revoked (caller maps to non-oracular HTTP).
   */
  revoke(
    tenantId: string,
    agentId: string,
    at: Date,
  ): Promise<DeviceIdentityRow | undefined>;
}

function asDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    return new Date(value);
  }
  throw new Error("expected a timestamp value");
}

function mapRow(row: {
  id: string;
  tenant_id: string;
  agent_id: string;
  public_key_ed25519: string;
  device_cert_pem: string | null;
  status: string;
  created_at: unknown;
  revoked_at: unknown;
}): DeviceIdentityRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    publicKeyEd25519: row.public_key_ed25519,
    deviceCertPem: row.device_cert_pem,
    status: row.status as DeviceIdentityStatus,
    createdAt: asDate(row.created_at),
    revokedAt: row.revoked_at ? asDate(row.revoked_at) : null,
  };
}

export function createDeviceIdentityRepository(
  db: Kysely<Database>,
): DeviceIdentityRepository {
  return {
    async findByAgentId(tenantId, agentId) {
      return withTenantTransaction(db, tenantId, async (trx) => {
        const row = await trx
          .selectFrom("device_identities")
          .selectAll()
          .where("agent_id", "=", agentId)
          .executeTakeFirst();
        return row ? mapRow(row) : undefined;
      });
    },

    async findById(tenantId, id) {
      return withTenantTransaction(db, tenantId, async (trx) => {
        const row = await trx
          .selectFrom("device_identities")
          .selectAll()
          .where("id", "=", id)
          .executeTakeFirst();
        return row ? mapRow(row) : undefined;
      });
    },

    async insert(tenantId, input) {
      return withTenantTransaction(db, tenantId, async (trx) => {
        const row = await trx
          .insertInto("device_identities")
          .values({
            tenant_id: tenantId,
            agent_id: input.agentId,
            public_key_ed25519: input.publicKeyEd25519,
            device_cert_pem: input.deviceCertPem ?? null,
            status: input.status ?? "pending",
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        return mapRow(row);
      });
    },

    async revoke(tenantId, agentId, at) {
      return withTenantTransaction(db, tenantId, async (trx) => {
        const row = await trx
          .updateTable("device_identities")
          .set({
            status: "revoked",
            revoked_at: at,
          })
          .where("agent_id", "=", agentId)
          .where("status", "!=", "revoked")
          .returningAll()
          .executeTakeFirst();
        return row ? mapRow(row) : undefined;
      });
    },
  };
}
