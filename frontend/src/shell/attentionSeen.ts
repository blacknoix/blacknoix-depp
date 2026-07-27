/**
 * Browser-local “caught up” cursor for the Attention digest.
 *
 * Not a preferences platform — one ISO timestamp per operator session scope.
 * Fail closed on corrupt values (treat as unset → server default lookback).
 *
 * Deferred: server-persisted last-seen, per-user notification preferences.
 */

import type { OperatorSession } from "../auth/session";

export const ATTENTION_SEEN_VERSION = 1 as const;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function attentionSeenStorageKey(session: OperatorSession): string {
  if (session.kind === "tenant") {
    return `depp.attention.seen.v${ATTENTION_SEEN_VERSION}.tenant.${session.tenantId}`;
  }
  return `depp.attention.seen.v${ATTENTION_SEEN_VERSION}.bearer`;
}

/** Returns a valid ISO timestamp, or null when unset/corrupt. */
export function loadAttentionSeenAt(
  session: OperatorSession,
  storage: StorageLike = localStorage,
): string | null {
  try {
    const raw = storage.getItem(attentionSeenStorageKey(session));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (record.version !== ATTENTION_SEEN_VERSION) {
      return null;
    }
    if (typeof record.seenAt !== "string") {
      return null;
    }
    const at = new Date(record.seenAt);
    if (Number.isNaN(at.getTime())) {
      return null;
    }
    return at.toISOString();
  } catch {
    return null;
  }
}

export function markAttentionSeenAt(
  session: OperatorSession,
  seenAt: string,
  storage: StorageLike = localStorage,
): { ok: true } | { ok: false; message: string } {
  const at = new Date(seenAt);
  if (Number.isNaN(at.getTime())) {
    return { ok: false, message: "seenAt must be an ISO-8601 timestamp" };
  }
  try {
    storage.setItem(
      attentionSeenStorageKey(session),
      JSON.stringify({
        version: ATTENTION_SEEN_VERSION,
        seenAt: at.toISOString(),
      }),
    );
    return { ok: true };
  } catch {
    return {
      ok: false,
      message: "Could not persist attention cursor in this browser.",
    };
  }
}

export function clearAttentionSeenAt(
  session: OperatorSession,
  storage: StorageLike = localStorage,
): void {
  try {
    storage.removeItem(attentionSeenStorageKey(session));
  } catch {
    // ignore
  }
}
