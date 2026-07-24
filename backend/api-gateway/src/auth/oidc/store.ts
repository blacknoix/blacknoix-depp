/**
 * Server-side store for OIDC login-initiation records.
 *
 * A record binds an in-flight login to the state/nonce/PKCE that DEPP generated
 * for it, plus the server-owned tenant. The callback is only honoured if the
 * returned `state` resolves to a live, unconsumed record here.
 *
 * `consume` is single-use: it removes the record before returning it, so a
 * second callback with the same state gets nothing (replay rejected), and it is
 * called at load time — before the token exchange — so a failed callback cannot
 * be retried with the same state either. One state is one attempt.
 *
 * This in-memory implementation is the single-instance/dev backend. Production
 * uses the Postgres-backed store in store-db.ts, which preserves the same
 * single-use + TTL semantics across process restarts and multiple gateway
 * instances. The interface is deliberately narrow so the backends are
 * interchangeable.
 */

export interface OidcInitiationRecord {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  /** Server-owned tenant binding, taken from config at initiation. */
  readonly tenantId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface OidcInitiationStore {
  put(record: OidcInitiationRecord): Promise<void>;
  /** Atomically fetch-and-remove; returns the record only if live and unconsumed. */
  consume(state: string, now?: number): Promise<OidcInitiationRecord | undefined>;
}

const MAX_RECORDS = 10_000;

export function createInMemoryInitiationStore(): OidcInitiationStore {
  const records = new Map<string, OidcInitiationRecord>();

  function pruneExpired(now: number): void {
    for (const [key, record] of records) {
      if (now > record.expiresAt) {
        records.delete(key);
      }
    }
  }

  return {
    async put(record) {
      // Bounded opportunistic cleanup so abandoned initiations cannot grow the
      // map without limit.
      if (records.size >= MAX_RECORDS) {
        pruneExpired(Date.now());
      }
      records.set(record.state, record);
    },

    async consume(state, now = Date.now()) {
      const record = records.get(state);
      if (!record) {
        return undefined;
      }

      // Single-use: remove before returning, regardless of what happens next.
      records.delete(state);

      if (now > record.expiresAt) {
        return undefined;
      }

      return record;
    },
  };
}
