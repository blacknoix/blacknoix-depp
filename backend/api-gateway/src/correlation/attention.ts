/**
 * Operator attention digest — pull-based “what changed since X”, plus
 * derived ownership reminders for quiet owned findings.
 *
 * Derived from correlation_findings only. Not a notification store, inbox,
 * rules engine, SLA engine, or real-time channel.
 *
 * Deferred: push/email/Slack, preferences, severity scoring, scheduled
 * reminder rules, escalations, live updates.
 */

import type { FindingStatus } from "./lifecycle";

/** Hard ceiling on lookback even if the client cursor is older. */
export const ATTENTION_MAX_LOOKBACK_HOURS = 24;

/** Cap on returned change-feed items after merge (newest first). */
export const ATTENTION_ITEMS_MAX = 20;

/** Per-source fetch limit before merge (detects truncation). */
export const ATTENTION_SOURCE_FETCH_LIMIT = 20;

/**
 * Owned findings whose last investigation touch is older than this are
 * surfaced as needs-revisit reminders. Fixed product constant — not an SLA.
 */
export const REMINDER_QUIET_HOURS = 24;

/** Cap on derived ownership reminders (oldest quiet first). */
export const REMINDER_ITEMS_MAX = 20;

export type AttentionKind =
  | "finding.created"
  | "finding.status_changed"
  | "finding.needs_revisit"
  | "finding.reminder_due";

export interface AttentionItem {
  kind: AttentionKind;
  findingId: string;
  title: string;
  status: FindingStatus;
  ruleId: string;
  agentId: string;
  /** Event time: created_at, status_changed_at, or last touch for reminders. */
  at: Date;
}

export interface OwnershipReminders {
  quietHours: number;
  items: AttentionItem[];
  truncated: boolean;
}

/** Explicit operator-deferred reminders due “now” or earlier. */
export interface DueReminders {
  items: AttentionItem[];
  truncated: boolean;
}

export interface FindingsAttentionDigest {
  generatedAt: Date;
  since: Date;
  maxLookbackHours: number;
  openCount: number;
  activeSuppressionCount: number;
  items: AttentionItem[];
  truncated: boolean;
  /** Derived ownership follow-ups; empty when operator identity is absent. */
  reminders: OwnershipReminders;
  /** Due explicit operator revisit reminders; empty when identity is absent. */
  dueReminders: DueReminders;
}

export interface AttentionRawSources {
  created: AttentionItem[];
  statusChanged: AttentionItem[];
  openCount: number;
  activeSuppressionCount: number;
  /** True when either source hit its fetch limit. */
  sourceTruncated: boolean;
}

/**
 * Resolves the effective since cursor.
 * - missing / invalid → fail closed for the caller (parse returns error)
 * - older than max lookback → clamped forward
 * - in the future → clamped to generatedAt
 */
export function resolveAttentionSince(
  requested: Date,
  generatedAt: Date,
  maxLookbackHours: number = ATTENTION_MAX_LOOKBACK_HOURS,
): Date {
  const floor = new Date(
    generatedAt.getTime() - maxLookbackHours * 60 * 60 * 1000,
  );
  if (requested.getTime() > generatedAt.getTime()) {
    return generatedAt;
  }
  if (requested.getTime() < floor.getTime()) {
    return floor;
  }
  return requested;
}

export type ParseAttentionSinceResult =
  | { ok: true; since: Date | null }
  | { ok: false; message: string };

/**
 * Parses optional `since` query param (ISO-8601).
 * null means “use default lookback” (caller applies max window).
 * Tenant identity in the query is rejected.
 */
export function parseAttentionSinceQuery(
  raw: unknown,
): ParseAttentionSinceResult {
  const params =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};

  for (const key of Object.keys(params)) {
    if (key === "tenantId" || key === "tenant_id" || key === "tid") {
      return {
        ok: false,
        message: "tenant identity must not be supplied in the query",
      };
    }
    if (key !== "since") {
      return { ok: false, message: `unknown query parameter: ${key}` };
    }
  }

  const sinceRaw = readSingle(params.since);
  if (sinceRaw === undefined) {
    return { ok: true, since: null };
  }

  const trimmed = sinceRaw.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: "since must be an ISO-8601 timestamp" };
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, message: "since must be an ISO-8601 timestamp" };
  }
  return { ok: true, since: parsed };
}

function readSingle(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }
  return undefined;
}

/**
 * Merges created + status-changed streams newest-first, capped.
 * Same finding may appear twice with different kinds (honest dual events).
 * Ownership reminders are assembled separately — not mixed into this feed.
 */
export function assembleAttentionDigest(
  generatedAt: Date,
  since: Date,
  raw: AttentionRawSources,
  reminders: OwnershipReminders = emptyOwnershipReminders(),
  dueReminders: DueReminders = emptyDueReminders(),
): FindingsAttentionDigest {
  const merged = [...raw.created, ...raw.statusChanged].sort(
    (a, b) => b.at.getTime() - a.at.getTime(),
  );
  const truncated =
    raw.sourceTruncated || merged.length > ATTENTION_ITEMS_MAX;
  return {
    generatedAt,
    since,
    maxLookbackHours: ATTENTION_MAX_LOOKBACK_HOURS,
    openCount: raw.openCount,
    activeSuppressionCount: raw.activeSuppressionCount,
    items: merged.slice(0, ATTENTION_ITEMS_MAX),
    truncated,
    reminders,
    dueReminders,
  };
}

export function emptyOwnershipReminders(): OwnershipReminders {
  return {
    quietHours: REMINDER_QUIET_HOURS,
    items: [],
    truncated: false,
  };
}

export function emptyDueReminders(): DueReminders {
  return {
    items: [],
    truncated: false,
  };
}

/**
 * Caps derived ownership reminders. Oldest quiet first is the caller’s order.
 */
export function assembleOwnershipReminders(
  items: AttentionItem[],
  sourceHitLimit: boolean,
): OwnershipReminders {
  return {
    quietHours: REMINDER_QUIET_HOURS,
    items: items.slice(0, REMINDER_ITEMS_MAX),
    truncated: sourceHitLimit || items.length > REMINDER_ITEMS_MAX,
  };
}

/** Quiet-before cutoff for ownership reminders at `generatedAt`. */
export function reminderQuietBefore(
  generatedAt: Date,
  quietHours: number = REMINDER_QUIET_HOURS,
): Date {
  return new Date(generatedAt.getTime() - quietHours * 60 * 60 * 1000);
}
