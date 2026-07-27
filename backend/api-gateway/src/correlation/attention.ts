/**
 * Operator attention digest — pull-based “what changed since X”, plus
 * derived ownership reminders, explicit due reminders, and a narrow
 * Action needed escalation tier.
 *
 * Derived at read time from correlation_findings / revisit reminders.
 * Not a notification store, inbox, rules engine, SLA engine, delivery
 * channel, or real-time push system.
 *
 * Deferred: email/Slack, websockets/SSE, preferences, severity scoring,
 * scheduled reminder rule configuration, full inbox, live updates.
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
 * surfaced as soft needs-revisit reminders. Fixed product constant — not an SLA.
 */
export const REMINDER_QUIET_HOURS = 24;

/**
 * Owned findings quiet at least this long escalate into Action needed
 * (exclusive of the soft Needs revisit band).
 */
export const ESCALATION_QUIET_HOURS = 48;

/**
 * Explicit reminders whose remind_at is at least this far past due escalate
 * into Action needed (exclusive of the soft Reminders due band).
 */
export const REMINDER_OVERDUE_HOURS = 4;

/** Cap on derived ownership reminders (oldest quiet first). */
export const REMINDER_ITEMS_MAX = 20;

/** Cap on Action needed escalation items. */
export const ACTION_NEEDED_ITEMS_MAX = 20;

export type AttentionKind =
  | "finding.created"
  | "finding.status_changed"
  | "finding.needs_revisit"
  | "finding.reminder_due"
  | "finding.action_needed";

export interface AttentionItem {
  kind: AttentionKind;
  findingId: string;
  title: string;
  status: FindingStatus;
  ruleId: string;
  agentId: string;
  /** Event time: created_at, status_changed_at, last touch, or remind_at. */
  at: Date;
}

export interface OwnershipReminders {
  quietHours: number;
  items: AttentionItem[];
  truncated: boolean;
}

/** Explicit operator-deferred reminders due “now” or earlier (not yet overdue). */
export interface DueReminders {
  items: AttentionItem[];
  truncated: boolean;
}

/**
 * Escalated in-product follow-ups: overdue explicit reminders and/or
 * long-quiet owned findings. Exclusive of soft Needs revisit / Reminders due.
 */
export interface ActionNeeded {
  overdueHours: number;
  escalationQuietHours: number;
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
  /** Soft derived ownership follow-ups; empty when operator identity is absent. */
  reminders: OwnershipReminders;
  /** Soft due explicit reminders; empty when identity is absent. */
  dueReminders: DueReminders;
  /** Escalated action items; empty when identity is absent. */
  actionNeeded: ActionNeeded;
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
 * Ownership / due / action-needed streams are assembled separately.
 */
export function assembleAttentionDigest(
  generatedAt: Date,
  since: Date,
  raw: AttentionRawSources,
  reminders: OwnershipReminders = emptyOwnershipReminders(),
  dueReminders: DueReminders = emptyDueReminders(),
  actionNeeded: ActionNeeded = emptyActionNeeded(),
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
    actionNeeded,
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

export function emptyActionNeeded(): ActionNeeded {
  return {
    overdueHours: REMINDER_OVERDUE_HOURS,
    escalationQuietHours: ESCALATION_QUIET_HOURS,
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

/**
 * Caps Action needed items. Caller should pass overdue-first, then long-quiet.
 */
export function assembleActionNeeded(
  items: AttentionItem[],
  sourceHitLimit: boolean,
): ActionNeeded {
  return {
    overdueHours: REMINDER_OVERDUE_HOURS,
    escalationQuietHours: ESCALATION_QUIET_HOURS,
    items: items.slice(0, ACTION_NEEDED_ITEMS_MAX),
    truncated: sourceHitLimit || items.length > ACTION_NEEDED_ITEMS_MAX,
  };
}

/**
 * Partitions soft due reminders vs overdue escalation candidates.
 * `at` is remind_at. Items with at <= overdueBefore escalate.
 */
export function partitionDueReminders(
  dueRows: AttentionItem[],
  overdueBefore: Date,
): { softDue: AttentionItem[]; overdue: AttentionItem[] } {
  const softDue: AttentionItem[] = [];
  const overdue: AttentionItem[] = [];
  for (const row of dueRows) {
    if (row.at.getTime() <= overdueBefore.getTime()) {
      overdue.push({ ...row, kind: "finding.action_needed" });
    } else {
      softDue.push({ ...row, kind: "finding.reminder_due" });
    }
  }
  return { softDue, overdue };
}

/**
 * Partitions soft Needs revisit vs long-quiet escalation candidates.
 * `at` is last touch. Items with at <= escalationQuietBefore escalate.
 * `excludeFindingIds` drops findings already escalated via overdue reminder.
 */
export function partitionOwnershipReminders(
  quietRows: AttentionItem[],
  escalationQuietBefore: Date,
  excludeFindingIds: ReadonlySet<string> = new Set(),
): { softQuiet: AttentionItem[]; escalatedQuiet: AttentionItem[] } {
  const softQuiet: AttentionItem[] = [];
  const escalatedQuiet: AttentionItem[] = [];
  for (const row of quietRows) {
    if (excludeFindingIds.has(row.findingId)) {
      continue;
    }
    if (row.at.getTime() <= escalationQuietBefore.getTime()) {
      escalatedQuiet.push({ ...row, kind: "finding.action_needed" });
    } else {
      softQuiet.push({ ...row, kind: "finding.needs_revisit" });
    }
  }
  return { softQuiet, escalatedQuiet };
}

/** Quiet-before cutoff for ownership reminders at `generatedAt`. */
export function reminderQuietBefore(
  generatedAt: Date,
  quietHours: number = REMINDER_QUIET_HOURS,
): Date {
  return new Date(generatedAt.getTime() - quietHours * 60 * 60 * 1000);
}

/** Follow-up kinds that support dismiss-until-change (not the change feed). */
export const DISMISSABLE_ATTENTION_KINDS = [
  "finding.needs_revisit",
  "finding.reminder_due",
  "finding.action_needed",
] as const;

export type DismissableAttentionKind =
  (typeof DISMISSABLE_ATTENTION_KINDS)[number];

export function isDismissableAttentionKind(
  value: string,
): value is DismissableAttentionKind {
  return (DISMISSABLE_ATTENTION_KINDS as readonly string[]).includes(value);
}

export interface AttentionDismissal {
  findingId: string;
  kind: DismissableAttentionKind;
  /** Watermark: item.at at dismiss time. */
  conditionAt: Date;
}

export function attentionDismissalKey(
  kind: string,
  findingId: string,
): string {
  return `${kind}:${findingId}`;
}

/**
 * True when the operator dismissed this item and the derived condition has
 * not advanced. Reappears when item.at > conditionAt or the kind changes.
 */
export function isAttentionItemDismissed(
  item: AttentionItem,
  dismissals: ReadonlyMap<string, Date>,
): boolean {
  if (!isDismissableAttentionKind(item.kind)) {
    return false;
  }
  const conditionAt = dismissals.get(
    attentionDismissalKey(item.kind, item.findingId),
  );
  if (!conditionAt) {
    return false;
  }
  return item.at.getTime() <= conditionAt.getTime();
}

export function filterDismissedAttentionItems(
  items: AttentionItem[],
  dismissals: ReadonlyMap<string, Date>,
): AttentionItem[] {
  return items.filter((item) => !isAttentionItemDismissed(item, dismissals));
}

export function toAttentionDismissalMap(
  rows: AttentionDismissal[],
): Map<string, Date> {
  const map = new Map<string, Date>();
  for (const row of rows) {
    map.set(attentionDismissalKey(row.kind, row.findingId), row.conditionAt);
  }
  return map;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DismissAttentionInput {
  findingId: string;
  kind: DismissableAttentionKind;
  conditionAt: Date;
}

export type ParseDismissAttentionResult =
  | { ok: true; dismiss: DismissAttentionInput }
  | { ok: false; message: string };

/**
 * Parses POST /v1/findings/attention/dismiss body.
 * conditionAt must match the surfaced item.at watermark from the digest.
 */
export function parseDismissAttentionBody(
  body: unknown,
): ParseDismissAttentionResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "body must be a JSON object" };
  }

  const record = body as Record<string, unknown>;
  const allowed = new Set(["findingId", "kind", "conditionAt"]);

  for (const key of Object.keys(record)) {
    if (key === "tenantId" || key === "tenant_id" || key === "tid") {
      return {
        ok: false,
        message: "tenant identity must not be supplied in the body",
      };
    }
    if (!allowed.has(key)) {
      return { ok: false, message: `unknown field: ${key}` };
    }
  }

  if (typeof record.findingId !== "string") {
    return { ok: false, message: "findingId must be a UUID" };
  }
  const findingId = record.findingId.trim().toLowerCase();
  if (!UUID.test(findingId)) {
    return { ok: false, message: "findingId must be a UUID" };
  }

  if (typeof record.kind !== "string") {
    return { ok: false, message: "kind must be a dismissable attention kind" };
  }
  if (!isDismissableAttentionKind(record.kind)) {
    return { ok: false, message: "kind must be a dismissable attention kind" };
  }

  if (typeof record.conditionAt !== "string") {
    return {
      ok: false,
      message: "conditionAt must be an ISO-8601 timestamp",
    };
  }
  const trimmed = record.conditionAt.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      message: "conditionAt must be an ISO-8601 timestamp",
    };
  }
  const conditionAt = new Date(trimmed);
  if (Number.isNaN(conditionAt.getTime())) {
    return {
      ok: false,
      message: "conditionAt must be an ISO-8601 timestamp",
    };
  }

  return {
    ok: true,
    dismiss: {
      findingId,
      kind: record.kind,
      conditionAt,
    },
  };
}
