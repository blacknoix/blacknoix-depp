import { type Kysely, sql } from "kysely";

import type { Database } from "../../db/schema";
import type { OidcInitiationRecord, OidcInitiationStore } from "./store";

/**
 * Postgres-backed OIDC initiation store — the production, HA implementation of
 * OidcInitiationStore. It preserves the single-use + TTL semantics of the
 * in-memory store across process restarts and multiple gateway instances.
 *
 * The table is platform-global (no RLS): the callback resolves records by
 * `state` alone, before any tenant context exists, so these queries run on the
 * pool directly rather than through withTenantTransaction. See
 * migrations/005_oidc_initiations.ts.
 */
export function createDbInitiationStore(db: Kysely<Database>): OidcInitiationStore {
  return {
    async put(record) {
      // created_at defaults to the DB clock; expires_at is stored absolute.
      await db
        .insertInto("oidc_initiations")
        .values({
          state: record.state,
          nonce: record.nonce,
          code_verifier: record.codeVerifier,
          tenant_id: record.tenantId,
          expires_at: new Date(record.expiresAt),
        })
        .execute();
    },

    async consume(state) {
      // Atomic single-use: exactly one caller's DELETE removes the row and gets
      // the RETURNING; concurrent callers for the same state — on this instance
      // or any other — get nothing. Deleting unconditionally also cleans up the
      // row on any consume attempt. Liveness is judged by the DB clock (`now()`),
      // which is authoritative across instances, not the app clock.
      const result = await sql<{
        nonce: string;
        code_verifier: string;
        tenant_id: string;
        created_at: Date;
        expires_at: Date;
        live: boolean;
      }>`
        delete from oidc_initiations
        where state = ${state}
        returning
          nonce,
          code_verifier,
          tenant_id,
          created_at,
          expires_at,
          (expires_at > now()) as live
      `.execute(db);

      const row = result.rows[0];
      if (!row || !row.live) {
        return undefined;
      }

      return {
        state,
        nonce: row.nonce,
        codeVerifier: row.code_verifier,
        tenantId: row.tenant_id,
        createdAt: new Date(row.created_at).getTime(),
        expiresAt: new Date(row.expires_at).getTime(),
      };
    },
  };
}

/**
 * Deletes expired initiation records. Consume already cleans up rows it touches;
 * this reclaims records that were never consumed. It is NOT scheduled in this
 * slice — invoking it periodically is a deferred maintenance concern.
 */
export async function deleteExpiredInitiations(db: Kysely<Database>): Promise<number> {
  const result = await db
    .deleteFrom("oidc_initiations")
    .where("expires_at", "<=", sql<Date>`now()`)
    .executeTakeFirst();

  return Number(result.numDeletedRows);
}
