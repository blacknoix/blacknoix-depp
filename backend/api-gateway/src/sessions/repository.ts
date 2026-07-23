import { type Kysely, sql } from "kysely";

import type { Database } from "../db/schema";
import { withTenantTransaction } from "../db/tenant-context";
import { generateRefreshToken, hashRefreshToken } from "./refresh-token";

export interface CreatedSession {
  sessionId: string;
  /** The plaintext refresh token — returned once, never stored. */
  refreshToken: string;
}

export type RotateResult =
  | { ok: true; sessionId: string; refreshToken: string }
  | { ok: false; reason: "invalid" | "replayed" | "session_revoked" };

export interface SessionsRepository {
  createSession(tenantId: string, userId: string): Promise<CreatedSession>;
  rotateRefreshToken(tenantId: string, rawToken: string): Promise<RotateResult>;
  revokeSession(tenantId: string, sessionId: string): Promise<boolean>;
  /**
   * Reads the user a session belongs to, tenant-scoped. Additive read used by
   * the auth service to mint an access token after rotation; it does not alter
   * the verified rotate/replay/revoke behaviour.
   */
  getSessionUserId(tenantId: string, sessionId: string): Promise<string | undefined>;
}

/**
 * Session and refresh-token lifecycle primitives (ADR-0003 §4).
 *
 * Every method runs through withTenantTransaction, so RLS constrains all reads
 * and writes to the authenticated tenant and an unscoped call fails closed. No
 * method issues a JWT — that is the auth-flow slice; these are the persistence
 * primitives it will call.
 */
export function createSessionsRepository(db: Kysely<Database>): SessionsRepository {
  return {
    async createSession(tenantId, userId) {
      return withTenantTransaction(db, tenantId, async (trx) => {
        const session = await trx
          .insertInto("sessions")
          .values({ tenant_id: tenantId, user_id: userId })
          .returning("id")
          .executeTakeFirstOrThrow();

        const refresh = generateRefreshToken();

        await trx
          .insertInto("refresh_tokens")
          .values({
            tenant_id: tenantId,
            session_id: session.id,
            token_hash: refresh.tokenHash,
          })
          .execute();

        return { sessionId: session.id, refreshToken: refresh.token };
      });
    },

    async rotateRefreshToken(tenantId, rawToken) {
      const tokenHash = hashRefreshToken(rawToken);

      return withTenantTransaction(db, tenantId, async (trx) => {
        // Atomic compare-and-swap: consume the token only if it is present,
        // not already consumed, AND its session is still active. Doing this as
        // one UPDATE (rather than select-then-update) means concurrent refreshes
        // of the same token cannot both succeed — exactly one flips consumed_at.
        const consumed = await sql<{ session_id: string }>`
          update refresh_tokens rt
          set consumed_at = now()
          where rt.token_hash = ${tokenHash}
            and rt.consumed_at is null
            and exists (
              select 1 from sessions s
              where s.id = rt.session_id
                and s.revoked_at is null
            )
          returning rt.session_id
        `.execute(trx);

        const consumedRow = consumed.rows[0];

        if (!consumedRow) {
          // The CAS matched nothing. Classify why, for the caller and for breach
          // detection, with a read in this same transaction.
          const existing = await trx
            .selectFrom("refresh_tokens")
            .select(["consumed_at"])
            .where("token_hash", "=", tokenHash)
            .executeTakeFirst();

          if (!existing) {
            return { ok: false, reason: "invalid" };
          }

          if (existing.consumed_at) {
            return { ok: false, reason: "replayed" };
          }

          // Present and unconsumed, yet the CAS failed: the session is revoked.
          return { ok: false, reason: "session_revoked" };
        }

        const next = generateRefreshToken();

        await trx
          .insertInto("refresh_tokens")
          .values({
            tenant_id: tenantId,
            session_id: consumedRow.session_id,
            token_hash: next.tokenHash,
          })
          .execute();

        return { ok: true, sessionId: consumedRow.session_id, refreshToken: next.token };
      });
    },

    async revokeSession(tenantId, sessionId) {
      return withTenantTransaction(db, tenantId, async (trx) => {
        const result = await trx
          .updateTable("sessions")
          .set({ revoked_at: sql`now()` })
          .where("id", "=", sessionId)
          .where("revoked_at", "is", null)
          .executeTakeFirst();

        return result.numUpdatedRows > 0n;
      });
    },

    async getSessionUserId(tenantId, sessionId) {
      return withTenantTransaction(db, tenantId, async (trx) => {
        const row = await trx
          .selectFrom("sessions")
          .select("user_id")
          .where("id", "=", sessionId)
          .executeTakeFirst();

        return row?.user_id;
      });
    },
  };
}
