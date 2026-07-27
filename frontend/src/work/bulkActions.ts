/**
 * Tiny Work-queue bulk actions — composition of existing single-item PATCH.
 *
 * Not a mass-edit engine. Deferred: bulk notes, reminders, assign-to-others,
 * Findings-list multi-select, CSV, automation.
 */

import type { FindingPatch } from "../api/findings";

export const BULK_ACTIONS = ["claim", "clear_owner", "resolve"] as const;

export type BulkAction = (typeof BULK_ACTIONS)[number];

/** Soft ceiling so sequential PATCHes stay bounded on the Work page. */
export const MAX_BULK_SELECTION = 20;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isBulkFindingId(value: string): boolean {
  return UUID.test(value.trim());
}

export function bulkActionLabel(action: BulkAction): string {
  if (action === "claim") {
    return "Claim to me";
  }
  if (action === "clear_owner") {
    return "Clear owner";
  }
  return "Mark resolved";
}

export function patchForBulkAction(action: BulkAction): FindingPatch {
  if (action === "claim") {
    return { claimOwner: true };
  }
  if (action === "clear_owner") {
    return { ownerUserId: null };
  }
  return { status: "resolved" };
}

export function toggleBulkSelection(
  selected: ReadonlySet<string>,
  findingId: string,
): Set<string> {
  const id = findingId.trim().toLowerCase();
  if (!isBulkFindingId(id)) {
    return new Set(selected);
  }
  const next = new Set(selected);
  if (next.has(id)) {
    next.delete(id);
    return next;
  }
  if (next.size >= MAX_BULK_SELECTION) {
    return next;
  }
  next.add(id);
  return next;
}

export function pruneBulkSelection(
  selected: ReadonlySet<string>,
  visibleIds: ReadonlySet<string>,
): Set<string> {
  const next = new Set<string>();
  for (const id of selected) {
    if (visibleIds.has(id)) {
      next.add(id);
    }
  }
  return next;
}

export function orderedBulkIds(selected: ReadonlySet<string>): string[] {
  return [...selected].sort();
}

export interface BulkActionItemResult {
  findingId: string;
  ok: boolean;
  error?: string;
}

export interface BulkActionSummary {
  action: BulkAction;
  attempted: number;
  succeeded: string[];
  failed: BulkActionItemResult[];
}

export function summarizeBulkResults(
  action: BulkAction,
  results: BulkActionItemResult[],
): BulkActionSummary {
  const succeeded: string[] = [];
  const failed: BulkActionItemResult[] = [];
  for (const row of results) {
    if (row.ok) {
      succeeded.push(row.findingId);
    } else {
      failed.push(row);
    }
  }
  return {
    action,
    attempted: results.length,
    succeeded,
    failed,
  };
}

export function formatBulkActionMessage(summary: BulkActionSummary): string {
  const label = bulkActionLabel(summary.action);
  if (summary.attempted === 0) {
    return "No findings selected.";
  }
  if (summary.failed.length === 0) {
    return `${label}: ${summary.succeeded.length} updated.`;
  }
  if (summary.succeeded.length === 0) {
    return `${label}: 0 of ${summary.attempted} updated. ${summary.failed.length} failed.`;
  }
  return `${label}: ${summary.succeeded.length} of ${summary.attempted} updated. ${summary.failed.length} failed.`;
}

export function collectVisibleFindingIds(input: {
  actionNeeded: readonly { findingId: string }[];
  remindersDue: readonly { findingId: string }[];
  mine: readonly { id: string }[];
  unownedOpen: readonly { id: string }[];
}): Set<string> {
  const ids = new Set<string>();
  for (const item of input.actionNeeded) {
    if (isBulkFindingId(item.findingId)) {
      ids.add(item.findingId.trim().toLowerCase());
    }
  }
  for (const item of input.remindersDue) {
    if (isBulkFindingId(item.findingId)) {
      ids.add(item.findingId.trim().toLowerCase());
    }
  }
  for (const finding of input.mine) {
    if (isBulkFindingId(finding.id)) {
      ids.add(finding.id.trim().toLowerCase());
    }
  }
  for (const finding of input.unownedOpen) {
    if (isBulkFindingId(finding.id)) {
      ids.add(finding.id.trim().toLowerCase());
    }
  }
  return ids;
}
