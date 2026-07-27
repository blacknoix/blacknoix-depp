/**
 * Compact Work queue health counters — derived from existing Work/Attention data.
 *
 * Not a BI dashboard, SLA engine, or trend report.
 * Deferred: charts, exports, historical trends, severity scoring.
 */

import type {
  ActionNeeded,
  AttentionItem,
  DueReminders,
  OwnershipReminders,
} from "../api/findings";
import type { Finding } from "../findings/types";
import type { WorkQueueSectionId } from "./workQueue";

/** Unowned open findings older than this (by createdAt) count as aged intake. */
export const UNOWNED_AGED_DAYS = 7;

export type WorkMetricId =
  | "action_needed"
  | "reminders_due"
  | "mine"
  | "unowned_open"
  | "unowned_aged";

export interface WorkQueueMetric {
  id: WorkMetricId;
  label: string;
  /** null = unavailable (typically missing operator identity). */
  value: number | null;
  truncated: boolean;
  /** Work section to focus when the metric is clicked; null if not navigable. */
  focusSection: WorkQueueSectionId | null;
  hint: string;
}

export interface WorkQueueMetrics {
  metrics: WorkQueueMetric[];
  generatedAt: string | null;
}

function countAgedUnowned(
  findings: readonly Finding[],
  now: Date,
  agedDays: number = UNOWNED_AGED_DAYS,
): number {
  const cutoff = now.getTime() - agedDays * 24 * 60 * 60 * 1000;
  let count = 0;
  for (const finding of findings) {
    const created = new Date(finding.createdAt).getTime();
    if (Number.isNaN(created)) {
      continue;
    }
    if (created <= cutoff) {
      count += 1;
    }
  }
  return count;
}

/**
 * Derive operational counters from the same sources Work already loads.
 * Uses pre-display-cap lists so counts stay honest relative to the fetch page.
 */
export function deriveWorkQueueMetrics(input: {
  hasIdentity: boolean;
  actionNeeded: Pick<ActionNeeded, "items" | "truncated" | "overdueHours" | "escalationQuietHours"> | null;
  dueReminders: Pick<DueReminders, "items" | "truncated"> | null;
  reminders: Pick<OwnershipReminders, "quietHours"> | null;
  mine: readonly Finding[];
  minePageFull: boolean;
  unownedOpen: readonly Finding[];
  unownedPageFull: boolean;
  now?: Date;
  generatedAt?: string | null;
}): WorkQueueMetrics {
  const now = input.now ?? new Date();
  const overdueHours = input.actionNeeded?.overdueHours ?? 4;
  const escalationQuietHours =
    input.actionNeeded?.escalationQuietHours ?? 48;

  const actionNeeded: WorkQueueMetric = {
    id: "action_needed",
    label: "Action needed",
    value: input.hasIdentity
      ? (input.actionNeeded?.items.length ?? 0)
      : null,
    truncated: Boolean(input.hasIdentity && input.actionNeeded?.truncated),
    focusSection: input.hasIdentity ? "action_needed" : null,
    hint: input.hasIdentity
      ? `Escalated: reminder overdue ≥${overdueHours}h or quiet ≥${escalationQuietHours}h`
      : "Requires operator identity",
  };

  const remindersDue: WorkQueueMetric = {
    id: "reminders_due",
    label: "Reminders due",
    value: input.hasIdentity
      ? (input.dueReminders?.items.length ?? 0)
      : null,
    truncated: Boolean(input.hasIdentity && input.dueReminders?.truncated),
    focusSection: input.hasIdentity ? "reminders_due" : null,
    hint: input.hasIdentity
      ? "Explicit revisit reminders that are due but not yet overdue"
      : "Requires operator identity",
  };

  const mine: WorkQueueMetric = {
    id: "mine",
    label: "Mine",
    value: input.hasIdentity ? input.mine.length : null,
    truncated: Boolean(input.hasIdentity && input.minePageFull),
    focusSection: input.hasIdentity ? "mine" : null,
    hint: input.hasIdentity
      ? "Findings currently assigned to you"
      : "Requires operator identity",
  };

  const unownedOpen: WorkQueueMetric = {
    id: "unowned_open",
    label: "Unowned open",
    value: input.unownedOpen.length,
    truncated: input.unownedPageFull,
    focusSection: "unowned_open",
    hint: "Open findings with no owner",
  };

  const aged = countAgedUnowned(input.unownedOpen, now);
  const unownedAged: WorkQueueMetric = {
    id: "unowned_aged",
    label: `Unowned ≥${UNOWNED_AGED_DAYS}d`,
    value: aged,
    truncated: input.unownedPageFull,
    focusSection: "unowned_open",
    hint: `Unowned open created at least ${UNOWNED_AGED_DAYS} days ago (intake age, not an SLA)`,
  };

  return {
    metrics: [
      actionNeeded,
      remindersDue,
      mine,
      unownedOpen,
      unownedAged,
    ],
    generatedAt: input.generatedAt ?? null,
  };
}

/** Format a metric value for display; unavailable → em dash. */
export function formatWorkMetricValue(metric: WorkQueueMetric): string {
  if (metric.value === null) {
    return "—";
  }
  return metric.truncated ? `${metric.value}+` : String(metric.value);
}

export function attentionItemsForMetric(
  id: WorkMetricId,
  items: {
    actionNeeded: readonly AttentionItem[];
    remindersDue: readonly AttentionItem[];
  },
): readonly AttentionItem[] {
  if (id === "action_needed") {
    return items.actionNeeded;
  }
  if (id === "reminders_due") {
    return items.remindersDue;
  }
  return [];
}
