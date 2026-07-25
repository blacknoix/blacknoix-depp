import type { Kysely } from "kysely";
import { sql } from "kysely";

import type { Database } from "../db/schema";
import { withTenantTransaction } from "../db/tenant-context";
import {
  agentCredentialHashesEqual,
  generateAgentCredential,
  hashAgentCredential,
} from "./credential";
import type { AgentInventoryRow } from "./inventory";
import { deriveHeartbeatFreshness } from "./inventory";
import { SILENCE_THRESHOLD_MS } from "../correlation/rules";

export interface RegisteredAgent {
  agentId: string;
  name: string;
  /** Plaintext credential — returned once; never persisted. */
  credential: string;
}

export type ExchangeOutcome =
  | { ok: true; agentId: string }
  | { ok: false; reason: "invalid" | "revoked" };

export interface AgentsRepository {
  register(
    tenantId: string,
    name: string,
  ): Promise<RegisteredAgent>;

  /**
   * Looks up an active credential by plaintext. Returns agentId on success.
   * Unknown hash, revoked credential, and wrong tenant all collapse to
   * invalid/revoked for the caller to map to a non-oracular client error.
   */
  exchangeCredential(
    tenantId: string,
    agentId: string,
    credential: string,
  ): Promise<ExchangeOutcome>;

  revokeActiveCredential(
    tenantId: string,
    agentId: string,
  ): Promise<boolean>;

  agentExists(tenantId: string, agentId: string): Promise<boolean>;

  /**
   * Operator inventory: agents + last heartbeat + open findings count.
   * Heartbeat freshness uses the silence threshold (not online/offline).
   */
  listInventory(
    tenantId: string,
    options?: { limit?: number; now?: Date },
  ): Promise<AgentInventoryRow[]>;
}

const MAX_NAME_LENGTH = 128;

function normalizeName(name: string): string {
  return name.trim();
}

/**
 * Agent identity + credential persistence. All access through
 * withTenantTransaction (ADR-0004).
 */
export function createAgentsRepository(db: Kysely<Database>): AgentsRepository {
  return {
    async register(tenantId, name) {
      const normalized = normalizeName(name);
      if (normalized.length === 0 || normalized.length > MAX_NAME_LENGTH) {
        throw new Error("agent name must be 1..128 characters");
      }

      const { credential, credentialHash } = generateAgentCredential();

      return withTenantTransaction(db, tenantId, async (trx) => {
        const agent = await trx
          .insertInto("agents")
          .values({ tenant_id: tenantId, name: normalized })
          .returning(["id", "name"])
          .executeTakeFirstOrThrow();

        await trx
          .insertInto("agent_credentials")
          .values({
            tenant_id: tenantId,
            agent_id: agent.id,
            credential_hash: credentialHash,
          })
          .execute();

        return {
          agentId: agent.id,
          name: agent.name,
          credential,
        };
      });
    },

    async exchangeCredential(tenantId, agentId, credential) {
      if (credential.trim() === "") {
        return { ok: false, reason: "invalid" };
      }

      const presentedHash = hashAgentCredential(credential);

      return withTenantTransaction(db, tenantId, async (trx) => {
        const row = await trx
          .selectFrom("agent_credentials")
          .select(["agent_id", "credential_hash", "revoked_at"])
          .where("agent_id", "=", agentId)
          .where("revoked_at", "is", null)
          .executeTakeFirst();

        if (!row) {
          // May be missing, wrong tenant (RLS), or all credentials revoked.
          // Distinguishing revoked vs unknown would be an oracle if we probed
          // revoked rows; treat both as invalid at the client.
          const any = await trx
            .selectFrom("agent_credentials")
            .select("id")
            .where("agent_id", "=", agentId)
            .executeTakeFirst();

          if (any) {
            return { ok: false, reason: "revoked" };
          }
          return { ok: false, reason: "invalid" };
        }

        if (!agentCredentialHashesEqual(row.credential_hash, presentedHash)) {
          return { ok: false, reason: "invalid" };
        }

        return { ok: true, agentId: row.agent_id };
      });
    },

    async revokeActiveCredential(tenantId, agentId) {
      return withTenantTransaction(db, tenantId, async (trx) => {
        const result = await trx
          .updateTable("agent_credentials")
          .set({ revoked_at: new Date() })
          .where("agent_id", "=", agentId)
          .where("revoked_at", "is", null)
          .executeTakeFirst();

        return (result.numUpdatedRows ?? 0n) > 0n;
      });
    },

    async agentExists(tenantId, agentId) {
      return withTenantTransaction(db, tenantId, async (trx) => {
        const row = await trx
          .selectFrom("agents")
          .select("id")
          .where("id", "=", agentId)
          .executeTakeFirst();
        return row !== undefined;
      });
    },

    async listInventory(tenantId, options = {}) {
      const limit = Math.min(Math.max(1, options.limit ?? 50), 100);
      const now = options.now ?? new Date();

      return withTenantTransaction(db, tenantId, async (trx) => {
        const rows = await trx
          .selectFrom("agents")
          .select([
            "id",
            "name",
            "created_at",
            sql<Date | string | null>`(
              select max(te.occurred_at)
              from telemetry_events as te
              where te.agent_id = agents.id
                and te.event_type = 'heartbeat'
            )`.as("last_heartbeat_at"),
            sql<string>`(
              select count(*)::text
              from correlation_findings as cf
              where cf.agent_id = agents.id
                and cf.status = 'open'
            )`.as("open_findings_count"),
          ])
          .orderBy("created_at", "desc")
          .limit(limit)
          .execute();

        return rows.map((row) => {
          const lastHeartbeatAt = row.last_heartbeat_at
            ? asInventoryDate(row.last_heartbeat_at)
            : null;

          return {
            id: row.id,
            name: row.name,
            createdAt: asInventoryDate(row.created_at),
            lastHeartbeatAt,
            openFindingsCount: Number(row.open_findings_count),
            heartbeatFreshness: deriveHeartbeatFreshness(
              lastHeartbeatAt,
              now,
              SILENCE_THRESHOLD_MS,
            ),
          };
        });
      });
    },
  };
}

function asInventoryDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    return new Date(value);
  }
  throw new Error("expected a timestamp value");
}
