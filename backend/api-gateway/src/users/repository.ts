import type { Kysely } from "kysely";

import type { Database } from "../db/schema";
import { withTenantTransaction } from "../db/tenant-context";

/**
 * The verified identity claims a strategy extracts from an IdP token.
 *
 * issuer + subject are the canonical identity key (ADR-0003 §9). email and
 * displayName are presentation fields, refreshed on each link but never used
 * to identify the user.
 */
export interface FederatedIdentity {
  issuer: string;
  subject: string;
  email?: string;
  displayName?: string;
}

export interface LinkedUser {
  /** The stable DEPP user id — the anchor for sessions, tokens, and roles. */
  id: string;
}

export interface UsersRepository {
  /**
   * Creates the user on first login, or returns the existing one, refreshing
   * the cached presentation fields. This is the just-in-time provisioning path
   * that the OIDC strategy calls after verifying a token (ADR-0003 §9).
   */
  findOrLinkByIdentity(
    tenantId: string,
    identity: FederatedIdentity,
  ): Promise<LinkedUser>;
}

/**
 * All access runs through withTenantTransaction, so RLS on users constrains
 * every statement to the authenticated tenant; a caller can neither read nor
 * create users outside its own tenant regardless of what it passes in.
 */
export function createUsersRepository(db: Kysely<Database>): UsersRepository {
  return {
    async findOrLinkByIdentity(tenantId, identity) {
      const issuer = identity.issuer.trim();
      const subject = identity.subject.trim();

      // An identity without both halves of the key is not an identity. Reject
      // before touching the database rather than storing an unusable row.
      if (issuer === "" || subject === "") {
        throw new Error("findOrLinkByIdentity requires non-empty issuer and subject");
      }

      return withTenantTransaction(db, tenantId, async (trx) => {
        // Single upsert: race-safe under concurrent first logins for the same
        // identity, unlike select-then-insert. ON CONFLICT DO UPDATE runs under
        // the same RLS policy, so it can only ever match a row in this tenant.
        const row = await trx
          .insertInto("users")
          .values({
            tenant_id: tenantId,
            issuer,
            subject,
            email: identity.email ?? null,
            display_name: identity.displayName ?? null,
          })
          .onConflict((oc) =>
            oc.columns(["tenant_id", "issuer", "subject"]).doUpdateSet({
              email: identity.email ?? null,
              display_name: identity.displayName ?? null,
            }),
          )
          .returning("id")
          .executeTakeFirstOrThrow();

        return { id: row.id };
      });
    },
  };
}
